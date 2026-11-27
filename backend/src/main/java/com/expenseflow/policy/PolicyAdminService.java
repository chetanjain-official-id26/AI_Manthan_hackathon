package com.expenseflow.policy;

import com.expenseflow.approval.ApprovalThreshold;
import com.expenseflow.approval.ApprovalThresholdRepository;
import com.expenseflow.audit.AuditEntry;
import com.expenseflow.audit.AuditWriter;
import com.expenseflow.claim.Category;
import com.expenseflow.claim.CityTier;
import com.expenseflow.claim.ClaimRepository;
import com.expenseflow.claim.ClaimStatus;
import com.expenseflow.common.Kv;
import com.expenseflow.common.Money;
import com.expenseflow.common.error.ApiException;
import com.expenseflow.policy.PolicyDtos.RollbackRequest;
import com.expenseflow.policy.PolicyDtos.RuleVersionRequest;
import com.expenseflow.policy.PolicyDtos.ThresholdRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Policy and threshold changes as new versions, never in place (LLD §3.2). Each change needs a
 * reason, is audited with before/after, and is blocked while the editor has a claim in flight (R7).
 */
@Service
public class PolicyAdminService {

    private final PolicyRuleRepository ruleRepo;
    private final ApprovalThresholdRepository thresholdRepo;
    private final ClaimRepository claimRepo;
    private final PolicyService policyService;
    private final AuditWriter audit;
    private final JsonMapper json;
    private final Clock clock;

    public PolicyAdminService(PolicyRuleRepository ruleRepo, ApprovalThresholdRepository thresholdRepo,
                              ClaimRepository claimRepo, PolicyService policyService, AuditWriter audit,
                              JsonMapper json, Clock clock) {
        this.ruleRepo = ruleRepo;
        this.thresholdRepo = thresholdRepo;
        this.claimRepo = claimRepo;
        this.policyService = policyService;
        this.audit = audit;
        this.json = json;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<PolicyRule> list(boolean includeHistory) {
        return includeHistory ? ruleRepo.findAll().stream()
                .sorted((a, b) -> a.getRuleCode().equals(b.getRuleCode())
                        ? Integer.compare(b.getVersion(), a.getVersion()) : a.getRuleCode().compareTo(b.getRuleCode()))
                .toList()
                : ruleRepo.findActive();
    }

    @Transactional
    public PolicyRule newVersion(String ruleCode, RuleVersionRequest req, Long actorId) {
        guardEditor(actorId, "POLICY_RULE", ruleCode);
        PolicyRule current = currentRow(ruleCode, req.category(), req.cityTier());
        PolicyRule next = current.copyAsNextVersion();
        if (req.limitAmount() != null) {
            next.setLimitAmount(Money.scale(req.limitAmount()));
        }
        if (req.action() != null) {
            next.setAction(req.action());
        }
        if (req.enabled() != null) {
            next.setEnabled(req.enabled());
        }
        if (req.params() != null) {
            next.setParams(json.writeValueAsString(req.params()));
        }
        return saveVersion(current, next, req.effectiveFrom() == null ? null : req.effectiveFrom().toInstant(),
                req.reason(), actorId, "POLICY_RULE_CHANGED");
    }

    /** EF-041: roll back = new version N+1 that copies version {@code toVersion}. History keeps moving forward. */
    @Transactional
    public PolicyRule rollback(String ruleCode, RollbackRequest req, Long actorId) {
        guardEditor(actorId, "POLICY_RULE", ruleCode);
        PolicyRule current = currentRow(ruleCode, req.category(), req.cityTier());
        PolicyRule source = ruleRepo.findHistory(ruleCode).stream()
                .filter(r -> sameKey(r, current.getCategory(), current.getCityTier()) && r.getVersion() == req.toVersion())
                .findFirst()
                .orElseThrow(() -> ApiException.notFound("Rule version " + req.toVersion()));
        PolicyRule next = current.copyAsNextVersion();
        next.setLimitAmount(source.getLimitAmount());
        next.setAction(source.getAction());
        next.setEnabled(source.isEnabled());
        next.setParams(source.getParams());
        next.setFlag(source.getFlag());
        return saveVersion(current, next, null, req.reason() + " (rollback to v" + req.toVersion() + ")", actorId,
                "POLICY_RULE_CHANGED");
    }

    private PolicyRule saveVersion(PolicyRule current, PolicyRule next, Instant effectiveFrom, String reason,
                                   Long actorId, String action) {
        Instant now = clock.instant();
        current.setActive(false); // the only update ever made to an old version
        ruleRepo.saveAndFlush(current);
        next.setEffectiveFrom(effectiveFrom == null ? now : effectiveFrom);
        next.setReason(reason);
        next.setCreatedBy(actorId);
        next.setCreatedAt(now);
        ruleRepo.save(next);
        audit.write(new AuditEntry(AuditEntry.POLICY_RULE, next.getId(), null, action, actorId, null,
                snapshot(current), snapshot(next)));
        policyService.evictCache();
        return next;
    }

    @Transactional(readOnly = true)
    public List<ApprovalThreshold> thresholds() {
        return thresholdRepo.findByActiveTrueOrderBySeqAsc();
    }

    /** ADR-001 §7: a new threshold applies only to new submissions and resubmissions. */
    @Transactional
    public ApprovalThreshold newThreshold(String level, ThresholdRequest req, Long actorId) {
        guardEditor(actorId, "APPROVAL_THRESHOLD", level);
        ApprovalThreshold cur = thresholdRepo.findFirstByLevelAndActiveTrue(level)
                .orElseThrow(() -> ApiException.notFound("Threshold " + level));
        cur.setActive(false);
        thresholdRepo.saveAndFlush(cur);
        ApprovalThreshold n = new ApprovalThreshold();
        n.setLevel(cur.getLevel());
        n.setSeq(cur.getSeq());
        n.setRole(cur.getRole());
        n.setMinTotalExclusive(Money.scale(req.minTotalExclusive()));
        n.setVersion(cur.getVersion() + 1);
        n.setReason(req.reason());
        n.setCreatedBy(actorId);
        n.setCreatedAt(clock.instant());
        thresholdRepo.save(n);
        audit.write(new AuditEntry(AuditEntry.THRESHOLD, n.getId(), null, "THRESHOLD_CHANGED", actorId, null,
                Kv.of("level", level, "minTotalExclusive", cur.getMinTotalExclusive(), "version", cur.getVersion()),
                Kv.of("level", level, "minTotalExclusive", n.getMinTotalExclusive(), "version", n.getVersion(),
                        "reason", req.reason())));
        return n;
    }

    /** R7: an editor with their own claim in flight may not change policy. The attempt is audited. */
    private void guardEditor(Long actorId, String entity, String key) {
        if (claimRepo.existsByEmployeeIdAndStatusIn(actorId, ClaimStatus.IN_FLIGHT)) {
            audit.writeIndependent(new AuditEntry(entity, null, null, "POLICY_CHANGE_BLOCKED", actorId, null, null,
                    Kv.of("key", key, "reason", "editor has a claim in flight")));
            throw ApiException.conflict("OWN_CLAIM_IN_FLIGHT",
                    "You cannot change policy while you have your own claim submitted or pending approval");
        }
    }

    private PolicyRule currentRow(String code, Category category, CityTier tier) {
        List<PolicyRule> rows = ruleRepo.findHistory(code).stream().filter(PolicyRule::isActive).toList();
        if (rows.isEmpty()) {
            throw ApiException.notFound("Policy rule " + code);
        }
        if (rows.size() == 1 && category == null && tier == null) {
            return rows.getFirst();
        }
        return rows.stream().filter(r -> sameKey(r, category, tier)).findFirst()
                .orElseThrow(() -> ApiException.unprocessable("RULE_KEY_REQUIRED",
                        "Rule " + code + " has several rows; give category and cityTier"));
    }

    private static boolean sameKey(PolicyRule r, Category category, CityTier tier) {
        return Objects.equals(r.getCategory(), category) && Objects.equals(r.getCityTier(), tier);
    }

    private Map<String, Object> snapshot(PolicyRule r) {
        return Kv.of("id", r.getId(), "ruleCode", r.getRuleCode(), "category", r.getCategory(),
                "cityTier", r.getCityTier(), "limitAmount", r.getLimitAmount(), "action", r.getAction(),
                "enabled", r.isEnabled(), "params", r.getParams(), "version", r.getVersion(),
                "effectiveFrom", r.getEffectiveFrom() == null ? null : r.getEffectiveFrom().toString());
    }
}
