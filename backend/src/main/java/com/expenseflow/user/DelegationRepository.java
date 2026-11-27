package com.expenseflow.user;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.LocalDate;
import java.util.List;

public interface DelegationRepository extends JpaRepository<Delegation, Long> {

    /** Delegations where {@code delegateId} may act for someone else on {@code day}. */
    @Query("select d from Delegation d where d.delegateId = :delegateId and d.revoked = false "
            + "and d.fromDate <= :day and d.toDate >= :day")
    List<Delegation> findActiveForDelegate(Long delegateId, LocalDate day);

    @Query("select d from Delegation d where d.revoked = false and d.fromDate <= :to and d.toDate >= :from")
    List<Delegation> findNonRevokedOverlapping(LocalDate from, LocalDate to);

    @Query("select d from Delegation d where d.delegatorId = :userId or d.delegateId = :userId order by d.fromDate desc")
    List<Delegation> findInvolving(Long userId);
}
