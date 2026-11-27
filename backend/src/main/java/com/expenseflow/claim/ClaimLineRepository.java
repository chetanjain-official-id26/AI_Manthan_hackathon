package com.expenseflow.claim;

import com.expenseflow.policy.engine.PolicyModel.HistoryLine;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.LocalDate;
import java.util.Collection;
import java.util.List;

public interface ClaimLineRepository extends JpaRepository<ClaimLine, Long> {

    /**
     * The employee's lines on the given dates in their other non-draft, non-policy-rejected claims.
     * Feeds the meal daily sum and the vendor+amount+date duplicate check.
     */
    @Query("select new com.expenseflow.policy.engine.PolicyModel$HistoryLine("
            + "l.id, c.id, c.claimNo, l.category, l.amount, l.expenseDate, l.vendorNorm) "
            + "from ClaimLine l join l.claim c "
            + "where c.employeeId = :employeeId and c.id <> :claimId and l.expenseDate in :dates "
            + "and c.status not in (com.expenseflow.claim.ClaimStatus.DRAFT, com.expenseflow.claim.ClaimStatus.POLICY_REJECTED) "
            + "order by l.id")
    List<HistoryLine> findHistory(Long employeeId, Long claimId, Collection<LocalDate> dates);

    @Query("select l.claim.id from ClaimLine l where l.id = :lineId")
    Long findClaimIdByLineId(Long lineId);
}
