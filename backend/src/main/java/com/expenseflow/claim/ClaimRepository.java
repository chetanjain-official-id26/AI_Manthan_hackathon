package com.expenseflow.claim;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.Collection;
import java.util.List;

public interface ClaimRepository extends JpaRepository<Claim, Long>, JpaSpecificationExecutor<Claim> {

    @Query(value = "select nextval('claim_no_seq')", nativeQuery = true)
    long nextClaimNumber();

    boolean existsByEmployeeIdAndStatusIn(Long employeeId, Collection<ClaimStatus> statuses);

    List<Claim> findByStatusOrderByApprovedAtAsc(ClaimStatus status);

    /** Same employee's other claims that count towards the split-claim rolling total (R1). */
    @Query("select c from Claim c where c.employeeId = :employeeId and c.id <> :claimId "
            + "and c.status in :statuses and c.submittedAt >= :since")
    List<Claim> findRecentForSplitCheck(Long employeeId, Long claimId, Collection<ClaimStatus> statuses, Instant since);

    long countByStatus(ClaimStatus status);
}
