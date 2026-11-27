package com.expenseflow.policy;

import com.expenseflow.audit.AuditEntry;
import com.expenseflow.audit.AuditWriter;
import com.expenseflow.common.Kv;
import com.expenseflow.common.error.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.util.Optional;

/** Reads business config from app_config; nothing here has a default limit in code. */
@Service
public class ConfigService {

    public static final String AUTO_APPROVE_MAX_TOTAL = "auto_approve_max_total";
    public static final String SAMPLE_AUDIT_RATE = "sample_audit_rate";
    public static final String SPLIT_WINDOW_DAYS = "split_window_days";
    public static final String ALTERNATE_FINANCE_APPROVER = "alternate_finance_approver_code";

    private final AppConfigRepository repo;
    private final AuditWriter audit;
    private final Clock clock;

    public ConfigService(AppConfigRepository repo, AuditWriter audit, Clock clock) {
        this.repo = repo;
        this.audit = audit;
        this.clock = clock;
    }

    public Optional<String> find(String key) {
        return repo.findFirstByConfigKeyAndActiveTrueOrderByVersionDesc(key).map(AppConfig::getConfigValue);
    }

    public String get(String key) {
        return find(key).orElseThrow(() -> new IllegalStateException("Missing app_config key " + key));
    }

    public BigDecimal decimal(String key) {
        return new BigDecimal(get(key));
    }

    public int integer(String key) {
        return Integer.parseInt(get(key));
    }

    /** Inserts a new version; the old one is deactivated in the same transaction. */
    @Transactional
    public AppConfig set(String key, String value, Long actorId, String reason) {
        if (reason == null || reason.isBlank()) {
            throw ApiException.unprocessable("REASON_REQUIRED", "A reason is required to change config");
        }
        var current = repo.findFirstByConfigKeyAndActiveTrueOrderByVersionDesc(key);
        int nextVersion = current.map(c -> c.getVersion() + 1).orElse(1);
        current.ifPresent(c -> {
            c.setActive(false);
            repo.saveAndFlush(c);
        });
        AppConfig n = new AppConfig();
        n.setConfigKey(key);
        n.setConfigValue(value);
        n.setVersion(nextVersion);
        n.setCreatedBy(actorId);
        n.setCreatedAt(clock.instant());
        repo.save(n);
        audit.write(new AuditEntry("APP_CONFIG", n.getId(), null, "CONFIG_CHANGED", actorId, null,
                Kv.of("key", key, "value", current.map(AppConfig::getConfigValue).orElse(null)),
                Kv.of("key", key, "value", value, "version", nextVersion, "reason", reason)));
        return n;
    }
}
