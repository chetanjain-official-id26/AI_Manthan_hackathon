package com.expenseflow.audit;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.List;

public interface AuditEventRepository extends JpaRepository<AuditEvent, Long>, JpaSpecificationExecutor<AuditEvent> {

    List<AuditEvent> findByClaimIdOrderByIdAsc(Long claimId);

    List<AuditEvent> findByEntityTypeAndEntityIdOrderByIdAsc(String entityType, Long entityId);

    long countByClaimIdAndAction(Long claimId, String action);
}
