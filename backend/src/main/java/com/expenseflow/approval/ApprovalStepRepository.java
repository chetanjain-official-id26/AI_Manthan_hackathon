package com.expenseflow.approval;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface ApprovalStepRepository extends JpaRepository<ApprovalStep, Long> {

    List<ApprovalStep> findByClaimIdOrderByCycleNoAscSeqAsc(Long claimId);

    List<ApprovalStep> findByClaimIdAndCycleNoOrderBySeqAsc(Long claimId, int cycleNo);

    Optional<ApprovalStep> findFirstByClaimIdAndStatus(Long claimId, StepStatus status);

    List<ApprovalStep> findByClaimIdAndStatusIn(Long claimId, Collection<StepStatus> statuses);

    boolean existsByClaimIdAndAssigneeIdOrClaimIdAndActedBy(Long claimId, Long assigneeId, Long claimId2, Long actedBy);

    /**
     * Pending steps the user may act on directly or through active delegations, excluding their own
     * claims (BR-18). Oldest first (EF-015).
     */
    @Query("select s from ApprovalStep s, com.expenseflow.claim.Claim c "
            + "where c.id = s.claimId and s.status = com.expenseflow.approval.StepStatus.PENDING "
            + "and c.employeeId <> :userId and ("
            + "  s.assigneeId in :assigneeIds "
            + "  or (s.assigneeId is null and s.assigneeRole in :poolRoles)) "
            + "order by s.activatedAt asc, s.id asc")
    List<ApprovalStep> findInbox(Long userId, Collection<Long> assigneeIds, Collection<String> poolRoles);
}
