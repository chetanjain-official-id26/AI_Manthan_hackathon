package com.expenseflow.policy;

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

import java.time.Instant;

/** One row per line per rule that fired, with the rule version (BR-14). */
@Entity
@Table(name = "policy_result")
@Getter
@Setter
@NoArgsConstructor
public class PolicyResult {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "claim_line_id", nullable = false)
    private Long claimLineId;

    @Column(name = "rule_id", nullable = false)
    private Long ruleId;

    @Column(name = "rule_code", nullable = false)
    private String ruleCode;

    @Column(name = "rule_version", nullable = false)
    private int ruleVersion;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Outcome outcome;

    private String flag;

    private String reason;

    @Column(name = "related_line_id")
    private Long relatedLineId;

    @Column(name = "evaluation_no", nullable = false)
    private int evaluationNo;

    @Column(name = "evaluated_at", nullable = false)
    private Instant evaluatedAt;
}
