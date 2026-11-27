package com.expenseflow.claim;

import com.expenseflow.policy.engine.PolicyModel.ReceiptMatch;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface ReceiptRepository extends JpaRepository<Receipt, Long> {

    Optional<Receipt> findByClaimLineId(Long claimLineId);

    List<Receipt> findByClaimLineIdIn(Collection<Long> lineIds);

    /** Lines of ANY employee's non-draft, non-policy-rejected claims whose receipt has one of the hashes. */
    @Query("select new com.expenseflow.policy.engine.PolicyModel$ReceiptMatch(l.id, c.id, c.claimNo, r.sha256) "
            + "from Receipt r, ClaimLine l join l.claim c "
            + "where r.claimLineId = l.id and r.sha256 in :hashes and c.id <> :claimId "
            + "and c.status not in (com.expenseflow.claim.ClaimStatus.DRAFT, com.expenseflow.claim.ClaimStatus.POLICY_REJECTED) "
            + "order by l.id")
    List<ReceiptMatch> findMatches(Collection<String> hashes, Long claimId);
}
