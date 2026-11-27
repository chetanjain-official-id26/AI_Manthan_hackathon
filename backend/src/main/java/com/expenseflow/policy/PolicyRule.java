package com.expenseflow.policy;

import com.expenseflow.claim.Category;
import com.expenseflow.claim.CityTier;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.ColumnTransformer;

import java.math.BigDecimal;
import java.time.Instant;

/** A versioned policy_rule row. Rows are never edited in place; a change inserts version N+1. */
@Entity
@Table(name = "policy_rule")
@Getter
@Setter
@NoArgsConstructor
public class PolicyRule {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "rule_code", nullable = false)
    private String ruleCode;

    @Enumerated(EnumType.STRING)
    private Category category;

    @Enumerated(EnumType.STRING)
    @Column(name = "city_tier")
    private CityTier cityTier;

    @Column(name = "limit_amount")
    private BigDecimal limitAmount;

    @Column(nullable = false)
    private String unit;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Outcome action;

    private String flag;

    @Column(columnDefinition = "jsonb", nullable = false)
    @ColumnTransformer(write = "?::jsonb")
    private String params = "{}";

    private boolean enabled = true;

    /** true only on the latest version of a (code, category, tier) key. */
    private boolean active = true;

    @Column(nullable = false)
    private int version;

    @Column(name = "effective_from", nullable = false)
    private Instant effectiveFrom;

    private String reason;

    @Column(name = "created_by")
    private Long createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    public PolicyRule copyAsNextVersion() {
        PolicyRule n = new PolicyRule();
        n.ruleCode = ruleCode;
        n.category = category;
        n.cityTier = cityTier;
        n.limitAmount = limitAmount;
        n.unit = unit;
        n.action = action;
        n.flag = flag;
        n.params = params;
        n.enabled = enabled;
        n.active = true;
        n.version = version + 1;
        return n;
    }
}
