package com.expenseflow.policy.engine;

import com.expenseflow.claim.Category;
import com.expenseflow.claim.CityTier;
import com.expenseflow.policy.Outcome;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** Plain value types used by the pure {@link PolicyEngine}. No JPA, no Spring. */
public final class PolicyModel {
    private PolicyModel() {
    }

    /** One versioned row of policy_rule. Null category / cityTier means "applies to all". */
    public record RuleDef(Long id, String code, Category category, CityTier cityTier, BigDecimal limit,
                          String unit, Outcome action, String flag, Map<String, Object> params,
                          int version, boolean enabled) {
    }

    /** A line of the claim being evaluated. */
    public record LineInput(Long lineId, Category category, BigDecimal amount, LocalDate date,
                            String vendorNorm, CityTier cityTier, Integer nights, String receiptSha256) {
    }

    /** A line of the same employee in an older non-draft, non-rejected claim. */
    public record HistoryLine(Long lineId, Long claimId, String claimNo, Category category, BigDecimal amount,
                              LocalDate date, String vendorNorm) {
    }

    /** A line anywhere (any employee, non-draft claim) whose receipt has the given hash. */
    public record ReceiptMatch(Long lineId, Long claimId, String claimNo, String sha256) {
    }

    public record PolicyInput(Long employeeId, List<LineInput> lines, List<HistoryLine> history,
                              List<ReceiptMatch> receiptMatches, LocalDate today) {
    }

    /** A rule that fired on a line. */
    public record RuleHit(Long lineId, Long ruleId, String ruleCode, int ruleVersion, Outcome outcome,
                          String flag, String reason, Long relatedLineId) {
    }
}
