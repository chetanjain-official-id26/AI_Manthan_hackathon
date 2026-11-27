package com.expenseflow.audit;

import com.expenseflow.common.web.RequestIdFilter;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

import java.time.Clock;
import java.util.Map;

/**
 * Writes audit rows in the SAME transaction as the change (LLD §9): if the change fails no row is
 * written, and if the insert fails the change rolls back. MANDATORY propagation enforces that.
 */
@Component
public class AuditWriter {

    private final AuditEventRepository repo;
    private final JsonMapper json;
    private final Clock clock;

    public AuditWriter(AuditEventRepository repo, JsonMapper json, Clock clock) {
        this.repo = repo;
        this.json = json;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public AuditEvent write(AuditEntry e) {
        AuditEvent ev = new AuditEvent();
        ev.setEntityType(e.entityType());
        ev.setEntityId(e.entityId());
        ev.setClaimId(e.claimId());
        ev.setAction(e.action());
        ev.setActorId(e.actorId());
        ev.setOnBehalfOfId(e.onBehalfOfId());
        ev.setBefore(toJson(e.before()));
        ev.setAfter(toJson(e.after()));
        ev.setRequestId(MDC.get(RequestIdFilter.MDC_REQUEST_ID));
        ev.setIp(MDC.get(RequestIdFilter.MDC_IP));
        ev.setCreatedAt(clock.instant());
        return repo.save(ev);
    }

    private String toJson(Map<String, ?> map) {
        return map == null ? null : json.writeValueAsString(map);
    }
}
