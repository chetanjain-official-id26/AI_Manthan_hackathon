package com.expenseflow.policy;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;
import java.util.List;

public interface PolicyRuleRepository extends JpaRepository<PolicyRule, Long> {

    @Query("select r from PolicyRule r where r.effectiveFrom <= :at order by r.ruleCode, r.version")
    List<PolicyRule> findEffectiveAt(Instant at);

    @Query("select r from PolicyRule r where r.ruleCode = :code order by r.version desc")
    List<PolicyRule> findHistory(String code);

    @Query("select r from PolicyRule r where r.active = true order by r.ruleCode, r.category, r.cityTier")
    List<PolicyRule> findActive();
}
