package com.expenseflow.policy;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface PolicyResultRepository extends JpaRepository<PolicyResult, Long> {

    List<PolicyResult> findByClaimLineIdInAndEvaluationNoOrderByIdAsc(Collection<Long> lineIds, int evaluationNo);
}
