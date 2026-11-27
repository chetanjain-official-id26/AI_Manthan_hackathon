package com.expenseflow.claim;

import com.expenseflow.policy.Outcome;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.OrderBy;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * A claim. {@code status} is changed only by {@link ClaimStateMachine}. {@code @Version} gives the
 * optimistic lock that stops double approval (BR-28).
 */
@Entity
@Table(name = "claim")
@Getter
@Setter
@NoArgsConstructor
public class Claim {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "claim_no", nullable = false)
    private String claimNo;

    @Column(name = "employee_id", nullable = false)
    private Long employeeId;

    @Column(nullable = false)
    private String title;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    @Setter(lombok.AccessLevel.PACKAGE)
    private ClaimStatus status;

    @Column(name = "total_amount", nullable = false)
    private BigDecimal totalAmount = new BigDecimal("0.00");

    @Column(name = "sample_audit")
    private boolean sampleAudit;

    @Column(name = "split_suspect")
    private boolean splitSuspect;

    @Enumerated(EnumType.STRING)
    @Column(name = "policy_outcome")
    private Outcome policyOutcome;

    @Column(name = "cycle_no")
    private int cycleNo;

    @Column(name = "submitted_at")
    private Instant submittedAt;

    @Column(name = "approved_at")
    private Instant approvedAt;

    @Column(name = "paid_at")
    private Instant paidAt;

    @Version
    private int version;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @OneToMany(mappedBy = "claim", cascade = CascadeType.ALL, orphanRemoval = true)
    @OrderBy("expenseDate ASC, id ASC")
    private List<ClaimLine> lines = new ArrayList<>();

    public void recomputeTotal() {
        totalAmount = lines.stream().map(ClaimLine::getAmount).reduce(new BigDecimal("0.00"), BigDecimal::add);
    }

    public Optional<ClaimLine> line(Long lineId) {
        return lines.stream().filter(l -> l.getId().equals(lineId)).findFirst();
    }

    public void addLine(ClaimLine line) {
        line.setClaim(this);
        lines.add(line);
        recomputeTotal();
    }

    public void removeLine(ClaimLine line) {
        lines.remove(line);
        recomputeTotal();
    }
}
