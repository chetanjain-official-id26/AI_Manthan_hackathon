package com.expenseflow.audit;

import com.expenseflow.support.IntegrationTest;
import com.expenseflow.user.Employee;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Audit trail immutability and completeness (BR-24, BR-25, TC-SEC-12). */
class AuditTrailIT extends IntegrationTest {

    @Test
    @DisplayName("TC-SEC-12 UPDATE, DELETE and TRUNCATE on audit_event raise a DB error (R15)")
    void appendOnly() throws Exception {
        long id = submittedClaim(emp("EMPLOYEE", null), "300.00");
        long eventId = jdbc.queryForObject("SELECT max(id) FROM audit_event WHERE claim_id = ?", Long.class, id);
        assertThatThrownBy(() -> jdbc.update("UPDATE audit_event SET action = 'X' WHERE id = ?", eventId))
                .hasMessageContaining("append-only");
        assertThatThrownBy(() -> jdbc.update("DELETE FROM audit_event WHERE id = ?", eventId))
                .hasMessageContaining("append-only");
        assertThatThrownBy(() -> jdbc.execute("TRUNCATE audit_event"))
                .hasMessageContaining("append-only");
    }

    @Test
    @DisplayName("BR-25 every claim status change has an audit row with actor, before and after")
    void everyStateChangeAudited() throws Exception {
        Employee mgr = emp("EMPLOYEE,MANAGER", null);
        Employee e = emp("EMPLOYEE", mgr);
        long id = submittedClaim(e, "26000.00");
        approve(id, mgr, 200);
        approve(id, emp("EMPLOYEE,AUDITOR", null), 200);
        // DRAFT→SUBMITTED, SUBMITTED→PENDING_MANAGER, →PENDING_AUDITOR, →APPROVED
        Long transitions = jdbc.queryForObject("SELECT count(*) FROM audit_event WHERE claim_id = ? AND entity_type = 'CLAIM' "
                + "AND before->>'status' IS NOT NULL AND after->>'status' IS NOT NULL "
                + "AND before->>'status' <> after->>'status'", Long.class, id);
        assertThat(transitions).isEqualTo(4);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_event WHERE claim_id = ? AND created_at IS NULL",
                Long.class, id)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_event WHERE claim_id = ? AND action = 'CLAIM_SUBMITTED' "
                + "AND actor_id = ?", Long.class, id, e.getId())).isEqualTo(1);
    }

    @Test
    @DisplayName("Delegation create and revoke are audited")
    void delegationAudited() throws Exception {
        Employee mgr = emp("EMPLOYEE,MANAGER", null);
        Employee d = emp("EMPLOYEE", null);
        long delId = post("/api/delegations", token(mgr), java.util.Map.of("delegateId", d.getId(),
                "fromDate", today().toString(), "toDate", today().plusDays(1).toString()), 201).get("id").asLong();
        call(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/delegations/" + delId),
                token(mgr), null, 204);
        assertThat(jdbc.queryForList("SELECT action FROM audit_event WHERE entity_type = 'DELEGATION' AND entity_id = ? ORDER BY id",
                String.class, delId)).containsExactly("DELEGATION_CREATED", "DELEGATION_REVOKED");
    }
}
