package com.expenseflow.approval;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;

/** Versioned approval threshold (ADR-001). A step is generated when total &gt; minTotalExclusive. */
@Entity
@Table(name = "approval_threshold")
@Getter
@Setter
@NoArgsConstructor
public class ApprovalThreshold {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String level;

    private int seq;

    @Column(name = "min_total_exclusive", nullable = false)
    private BigDecimal minTotalExclusive;

    @Column(nullable = false)
    private String role;

    private int version;

    private boolean active = true;

    private String reason;

    @Column(name = "created_by")
    private Long createdBy;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();
}
