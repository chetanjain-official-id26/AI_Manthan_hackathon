package com.expenseflow.approval;

import com.expenseflow.policy.ConfigService;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.Random;

/** BR-20: picks auto-approved claims for audit with probability sample_audit_rate (config). */
@Component
public class SampleAuditSelector {

    private final Random random;
    private final ConfigService config;

    public SampleAuditSelector(Random sampleAuditRandom, ConfigService config) {
        this.random = sampleAuditRandom;
        this.config = config;
    }

    public boolean pick() {
        return pick(config.decimal(ConfigService.SAMPLE_AUDIT_RATE));
    }

    public boolean pick(BigDecimal rate) {
        double r;
        synchronized (random) {
            r = random.nextDouble();
        }
        return BigDecimal.valueOf(r).compareTo(rate) < 0;
    }
}
