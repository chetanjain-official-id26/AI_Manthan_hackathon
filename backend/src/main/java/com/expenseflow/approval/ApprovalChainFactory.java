package com.expenseflow.approval;

import com.expenseflow.claim.Claim;
import com.expenseflow.claim.ClaimLine;
import com.expenseflow.claim.ClaimRepository;
import com.expenseflow.claim.ClaimStatus;
import com.expenseflow.common.Money;
import com.expenseflow.common.security.Role;
import com.expenseflow.policy.ConfigService;
import com.expenseflow.user.Employee;
import com.expenseflow.user.EmployeeRepository;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

/**
 * Generates snapshotted approval_step rows at submit time from approval_threshold (BR-06..09,
 * ADR-001). Also applies the claim-splitting rolling total (R1).
 */
@Component
public class ApprovalChainFactory {

    private static final Set<ClaimStatus> SPLIT_COUNTED = EnumSet.of(ClaimStatus.SUBMITTED,
            ClaimStatus.PENDING_MANAGER, ClaimStatus.PENDING_AUDITOR, ClaimStatus.PENDING_FINANCE_HEAD,
            ClaimStatus.APPROVED, ClaimStatus.IN_PAYOUT, ClaimStatus.PAID);

    private final ApprovalThresholdRepository thresholds;
    private final ApprovalStepRepository steps;
    private final ClaimRepository claims;
    private final EmployeeRepository employees;
    private final ConfigService config;

    public ApprovalChainFactory(ApprovalThresholdRepository thresholds, ApprovalStepRepository steps,
                                ClaimRepository claims, EmployeeRepository employees, ConfigService config) {
        this.thresholds = thresholds;
        this.steps = steps;
        this.claims = claims;
        this.employees = employees;
        this.config = config;
    }

    /** Pure: thresholds that apply to a total (strictly greater than min_total_exclusive). */
    public static List<ApprovalThreshold> plan(BigDecimal total, List<ApprovalThreshold> active) {
        return active.stream()
                .filter(t -> Money.gt(total, t.getMinTotalExclusive()))
                .sorted((a, b) -> Integer.compare(a.getSeq(), b.getSeq()))
                .toList();
    }

    public record Chain(List<ApprovalStep> steps, boolean splitSuspect, BigDecimal effectiveTotal) {
        public ApprovalStep first() {
            return steps.getFirst();
        }
    }

    public Chain create(Claim claim, Instant now) {
        List<ApprovalThreshold> active = thresholds.findByActiveTrueOrderBySeqAsc();
        BigDecimal total = claim.getTotalAmount();
        BigDecimal rolling = total.add(splitCompanionsTotal(claim, now));
        List<ApprovalThreshold> own = plan(total, active);
        List<ApprovalThreshold> withRolling = plan(rolling, active);
        boolean split = withRolling.size() > own.size();

        Employee owner = employees.findById(claim.getEmployeeId()).orElseThrow();
        List<ApprovalStep> created = new ArrayList<>();
        int seq = 1;
        for (ApprovalThreshold t : withRolling) {
            ApprovalStep s = new ApprovalStep();
            s.setClaimId(claim.getId());
            s.setSeq(seq);
            s.setLevel(t.getLevel());
            s.setThresholdId(t.getId());
            s.setCycleNo(claim.getCycleNo());
            s.setCreatedAt(now);
            s.setStatus(seq == 1 ? StepStatus.PENDING : StepStatus.WAITING);
            s.setActivatedAt(seq == 1 ? now : null);
            assign(s, t, owner);
            created.add(s);
            seq++;
        }
        steps.saveAll(created);
        return new Chain(created, split, rolling);
    }

    /** Single auditor step for a sampled auto-approved claim (BR-20). */
    public ApprovalStep sampleStep(Claim claim, Instant now) {
        ApprovalStep s = new ApprovalStep();
        s.setClaimId(claim.getId());
        s.setSeq(1);
        s.setLevel("AUDITOR");
        s.setAssigneeRole(Role.AUDITOR.name());
        s.setCycleNo(claim.getCycleNo());
        s.setCreatedAt(now);
        s.setStatus(StepStatus.PENDING);
        s.setActivatedAt(now);
        s.setNote("Sample audit");
        return steps.save(s);
    }

    private void assign(ApprovalStep s, ApprovalThreshold t, Employee owner) {
        switch (t.getLevel()) {
            case "MANAGER" -> {
                s.setAssigneeRole(Role.MANAGER.name());
                if (owner.getManagerId() != null) {
                    s.setAssigneeId(owner.getManagerId());
                } else {
                    assignAlternate(s, owner);
                }
            }
            case "AUDITOR" -> s.setAssigneeRole(Role.AUDITOR.name()); // pool
            case "FINANCE_HEAD" -> {
                s.setAssigneeRole(Role.FINANCE_HEAD.name());
                if (owner.hasRole(Role.FINANCE_HEAD)) {
                    assignAlternate(s, owner); // ADR-001 §2: FH's own claim goes to the alternate
                }
            }
            default -> throw new IllegalStateException("Unknown level " + t.getLevel());
        }
    }

    private void assignAlternate(ApprovalStep s, Employee owner) {
        Long alt = config.find(ConfigService.ALTERNATE_FINANCE_APPROVER)
                .flatMap(employees::findByEmpCode)
                .filter(e -> !e.getId().equals(owner.getId()))
                .map(Employee::getId)
                .orElse(null);
        if (alt != null) {
            s.setAssigneeId(alt);
        } else {
            s.setAssigneeId(null);
            s.setAssigneeRole(Role.FINANCE_HEAD.name());
        }
    }

    /**
     * R1: totals of the same employee's other claims submitted within the window whose expense dates
     * lie within the window of this claim's dates.
     */
    BigDecimal splitCompanionsTotal(Claim claim, Instant now) {
        int window = config.find(ConfigService.SPLIT_WINDOW_DAYS).map(Integer::parseInt).orElse(0);
        if (window <= 0 || claim.getLines().isEmpty()) {
            return BigDecimal.ZERO;
        }
        LocalDate min = claim.getLines().stream().map(ClaimLine::getExpenseDate).min(LocalDate::compareTo).orElseThrow();
        LocalDate max = claim.getLines().stream().map(ClaimLine::getExpenseDate).max(LocalDate::compareTo).orElseThrow();
        BigDecimal sum = BigDecimal.ZERO;
        for (Claim other : claims.findRecentForSplitCheck(claim.getEmployeeId(), claim.getId(), SPLIT_COUNTED,
                now.minus(Duration.ofDays(window)))) {
            LocalDate oMin = other.getLines().stream().map(ClaimLine::getExpenseDate).min(LocalDate::compareTo)
                    .orElse(null);
            LocalDate oMax = other.getLines().stream().map(ClaimLine::getExpenseDate).max(LocalDate::compareTo)
                    .orElse(null);
            if (oMin != null && !oMin.isAfter(max.plusDays(window)) && !oMax.isBefore(min.minusDays(window))) {
                sum = sum.add(other.getTotalAmount());
            }
        }
        return sum;
    }
}
