package com.expenseflow.policy;

import com.expenseflow.approval.ApprovalThreshold;
import com.expenseflow.claim.Category;
import com.expenseflow.claim.CityTier;
import com.expenseflow.common.time.Ist;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.Map;

public final class PolicyDtos {
    private PolicyDtos() {
    }

    /** Fields left null keep the current value. category / cityTier pick the row when a code has several. */
    public record RuleVersionRequest(Category category, CityTier cityTier,
                                     @DecimalMin("0.00") @Digits(integer = 12, fraction = 2) BigDecimal limitAmount,
                                     Outcome action, Boolean enabled, Map<String, Object> params,
                                     OffsetDateTime effectiveFrom,
                                     @NotBlank @Size(max = 250) String reason) {
    }

    public record RollbackRequest(Category category, CityTier cityTier, @Min(1) int toVersion,
                                  @NotBlank @Size(max = 200) String reason) {
    }

    public record ThresholdRequest(@NotNull @DecimalMin("0.00") @Digits(integer = 12, fraction = 2)
                                   BigDecimal minTotalExclusive,
                                   @NotBlank @Size(max = 250) String reason) {
    }

    public record RuleView(Long id, String ruleCode, Category category, CityTier cityTier, BigDecimal limitAmount,
                           String unit, Outcome action, String flag, String params, boolean enabled, boolean active,
                           int version, OffsetDateTime effectiveFrom, String reason, Long createdBy) {
        public static RuleView of(PolicyRule r) {
            return new RuleView(r.getId(), r.getRuleCode(), r.getCategory(), r.getCityTier(), r.getLimitAmount(),
                    r.getUnit(), r.getAction(), r.getFlag(), r.getParams(), r.isEnabled(), r.isActive(),
                    r.getVersion(), Ist.render(r.getEffectiveFrom()), r.getReason(), r.getCreatedBy());
        }
    }

    public record ThresholdView(Long id, String level, int seq, BigDecimal minTotalExclusive, String role,
                                int version) {
        public static ThresholdView of(ApprovalThreshold t) {
            return new ThresholdView(t.getId(), t.getLevel(), t.getSeq(), t.getMinTotalExclusive(), t.getRole(),
                    t.getVersion());
        }
    }
}
