package com.expenseflow.approval;

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

/** One snapshotted step of a claim's approval chain (ADR-001 option b). */
@Entity
@Table(name = "approval_step")
@Getter
@Setter
@NoArgsConstructor
public class ApprovalStep {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "claim_id", nullable = false)
    private Long claimId;

    private int seq;

    @Column(nullable = false)
    private String level;

    /** Null for a pool step (any user with {@link #assigneeRole} may act). */
    @Column(name = "assignee_id")
    private Long assigneeId;

    @Column(name = "assignee_role", nullable = false)
    private String assigneeRole;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private StepStatus status;

    @Column(name = "threshold_id")
    private Long thresholdId;

    @Column(name = "acted_by")
    private Long actedBy;

    @Column(name = "on_behalf_of")
    private Long onBehalfOf;

    @Column(name = "activated_at")
    private Instant activatedAt;

    @Column(name = "acted_at")
    private Instant actedAt;

    private String note;

    @Column(name = "cycle_no", nullable = false)
    private int cycleNo;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
}
