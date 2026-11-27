package com.expenseflow.approval;

import com.expenseflow.claim.Category;
import com.expenseflow.claim.CityTier;
import com.expenseflow.support.IntegrationTest;
import com.expenseflow.user.Delegation;
import com.expenseflow.user.DelegationRepository;
import com.expenseflow.user.Employee;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.databind.JsonNode;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;

/** Approval chain and delegation (Test Plan Â§7.2) plus approval security cases (Â§7.7). */
class ApprovalFlowIT extends IntegrationTest {

    @Autowired
    DelegationRepository delegationRepo;

    private record Org(Employee manager, Employee employee, Employee auditor, Employee financeHead) {
    }

    private Org org() {
        Employee mgr = emp("EMPLOYEE,MANAGER", null);
        return new Org(mgr, emp("EMPLOYEE", mgr), emp("EMPLOYEE,AUDITOR", null), emp("EMPLOYEE,FINANCE_HEAD", null));
    }

    private List<String> levels(long claimId, int cycle) {
        return jdbc.queryForList("SELECT level FROM approval_step WHERE claim_id = ? AND cycle_no = ? ORDER BY seq",
                String.class, claimId, cycle);
    }

    @Test
    @DisplayName("TC-APR-01 inbox shows my reportees' pending claims only, oldest first, with age")
    void inbox() throws Exception {
        Org o = org();
        Employee r2 = emp("EMPLOYEE", o.manager());
        Employee r3 = emp("EMPLOYEE", o.manager());
        Instant now = Instant.now();
        clock.set(now.minus(Duration.ofHours(30)));
        long oldest = submittedClaim(o.employee(), "6000.00");
        clock.set(now.minus(Duration.ofHours(20)));
        long middle = submittedClaim(r2, "7000.00");
        clock.set(now.minus(Duration.ofHours(10)));
        long newest = submittedClaim(r3, "8000.00");
        clock.reset();
        Employee otherMgr = emp("EMPLOYEE,MANAGER", null);
        submittedClaim(emp("EMPLOYEE", otherMgr), "9000.00");

        JsonNode inbox = get("/api/approvals/inbox?sort=age", token(o.manager()), 200);
        assertThat(inbox).hasSize(3);
        List<Long> ids = new ArrayList<>();
        inbox.forEach(n -> ids.add(n.get("claimId").asLong()));
        assertThat(ids).containsExactly(oldest, middle, newest);
        assertThat(inbox.get(0).get("ageHours").asLong()).isGreaterThanOrEqualTo(29);
        assertThat(inbox.get(0).get("level").asText()).isEqualTo("MANAGER");
    }

    @Test
    @DisplayName("TC-APR-02 total 25,000.00 â†’ manager only â†’ APPROVED")
    void exactly25k() throws Exception {
        Org o = org();
        long id = submittedClaim(o.employee(), "25000.00");
        assertThat(levels(id, 1)).containsExactly("MANAGER");
        approve(id, o.manager(), 200);
        assertThat(status(id)).isEqualTo("APPROVED");
        assertThat(auditCount(id, "CLAIM_APPROVED")).isEqualTo(1);
    }

    @Test
    @DisplayName("TC-APR-03 total 25,000.01 â†’ manager approve â†’ PENDING_AUDITOR")
    void above25k() throws Exception {
        Org o = org();
        long id = submittedClaim(o.employee(), "25000.01");
        assertThat(levels(id, 1)).containsExactly("MANAGER", "AUDITOR");
        approve(id, o.manager(), 200);
        assertThat(status(id)).isEqualTo("PENDING_AUDITOR");
        approve(id, o.auditor(), 200);
        assertThat(status(id)).isEqualTo("APPROVED");
    }

    @Test
    @DisplayName("TC-APR-04 total 1,00,000.00 â†’ manager â†’ auditor â†’ APPROVED (no finance head)")
    void exactly1L() throws Exception {
        Org o = org();
        long id = submittedClaim(o.employee(), "100000.00");
        assertThat(levels(id, 1)).containsExactly("MANAGER", "AUDITOR");
        approve(id, o.manager(), 200);
        approve(id, o.auditor(), 200);
        assertThat(status(id)).isEqualTo("APPROVED");
    }

    @Test
    @DisplayName("TC-APR-05 total 1,00,000.01 â†’ manager â†’ auditor â†’ PENDING_FINANCE_HEAD â†’ APPROVED")
    void above1L() throws Exception {
        Org o = org();
        long id = submittedClaim(o.employee(), "100000.01");
        assertThat(levels(id, 1)).containsExactly("MANAGER", "AUDITOR", "FINANCE_HEAD");
        approve(id, o.manager(), 200);
        approve(id, o.auditor(), 200);
        assertThat(status(id)).isEqualTo("PENDING_FINANCE_HEAD");
        approve(id, o.financeHead(), 200);
        assertThat(status(id)).isEqualTo("APPROVED");
        assertThat(auditCount(id, "STEP_APPROVED")).isEqualTo(3);
    }

    @Test
    @DisplayName("TC-APR-06 reject needs a reason: '' â†’ 422, then with a reason â†’ REJECTED and audited")
    void rejectNeedsReason() throws Exception {
        Org o = org();
        long id = submittedClaim(o.employee(), "8000.00");
        post("/api/claims/" + id + "/reject", token(o.manager()), Map.of("version", claimVersion(id), "reason", ""), 422);
        post("/api/claims/" + id + "/reject", token(o.manager()),
                Map.of("version", claimVersion(id), "reason", "Not business related"), 200);
        assertThat(status(id)).isEqualTo("REJECTED");
        assertThat(auditCount(id, "STEP_REJECTED")).isEqualTo(1);
        assertThat(auditCount(id, "CLAIM_REJECTED")).isEqualTo(1);
    }

    @Test
    @DisplayName("TC-APR-07 send back at auditor + edit + resubmit: old chain cancelled, cycle 2 restarts at manager")
    void sendBackRestartsChain() throws Exception {
        Org o = org();
        String t = token(o.employee());
        long id = createClaim(t, "Conference");
        long line = addReceiptedLine(id, t, "60000.00");
        submit(id, t);
        approve(id, o.manager(), 200);
        assertThat(status(id)).isEqualTo("PENDING_AUDITOR");
        post("/api/claims/" + id + "/send-back", token(o.auditor()), Map.of("version", claimVersion(id), "comment", ""), 422);
        post("/api/claims/" + id + "/send-back", token(o.auditor()),
                Map.of("version", claimVersion(id), "comment", "Split hotel and flights please"), 200);
        assertThat(status(id)).isEqualTo("SENT_BACK");
        JsonNode d = get("/api/claims/" + id, t, 200);
        assertThat(d.at("/comments/0/body").asText()).contains("Split hotel");
        assertThat(d.at("/permissions/canEdit").asBoolean()).isTrue();

        put("/api/claims/" + id + "/lines/" + line, t,
                line(Category.OTHER, "20000.00", weekday(), "Airline", CityTier.TIER_1, null), 200);
        submit(id, t);
        assertThat(status(id)).isEqualTo("PENDING_MANAGER");
        assertThat(jdbc.queryForList("SELECT status FROM approval_step WHERE claim_id = ? AND cycle_no = 1 ORDER BY seq",
                String.class, id)).containsExactly("APPROVED", "SENT_BACK");
        assertThat(levels(id, 2)).containsExactly("MANAGER");
        assertThat(auditCount(id, "CLAIM_RESUBMITTED")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT count(DISTINCT evaluation_no) FROM policy_result pr "
                + "JOIN claim_line l ON l.id = pr.claim_line_id WHERE l.claim_id = ?", Integer.class, id)).isLessThanOrEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_event WHERE claim_id = ? AND action = 'POLICY_EVALUATED'",
                Integer.class, id)).isEqualTo(2);
    }

    @Test
    @DisplayName("TC-APR-08 active delegation: delegate sees and approves; audit records on_behalf_of")
    void delegateApproves() throws Exception {
        Org o = org();
        Employee d = emp("EMPLOYEE,MANAGER", null);
        long id = submittedClaim(o.employee(), "9000.00");
        post("/api/delegations", token(o.manager()), Map.of("delegateId", d.getId(), "fromDate", today().toString(),
                "toDate", today().plusDays(3).toString(), "reason", "Leave"), 201);

        JsonNode inbox = get("/api/approvals/inbox", token(d), 200);
        assertThat(inbox).anySatisfy(n -> {
            assertThat(n.get("claimId").asLong()).isEqualTo(id);
            assertThat(n.get("onBehalfOf").asLong()).isEqualTo(o.manager().getId());
        });
        get("/api/claims/" + id, token(d), 200);
        approve(id, d, 200);
        assertThat(status(id)).isEqualTo("APPROVED");
        Map<String, Object> ev = jdbc.queryForMap("SELECT actor_id, on_behalf_of_id FROM audit_event "
                + "WHERE claim_id = ? AND action = 'STEP_APPROVED'", id);
        assertThat(((Number) ev.get("actor_id")).longValue()).isEqualTo(d.getId());
        assertThat(((Number) ev.get("on_behalf_of_id")).longValue()).isEqualTo(o.manager().getId());
        JsonNode detail = get("/api/claims/" + id, token(o.employee()), 200);
        assertThat(detail.at("/steps/0/onBehalfOfName").asText()).isEqualTo(o.manager().getName());
    }

    @Test
    @DisplayName("TC-APR-09 expired delegation: the delegate gets 404 and an empty inbox")
    void expiredDelegation() throws Exception {
        Org o = org();
        Employee d = emp("EMPLOYEE", null);
        long id = submittedClaim(o.employee(), "9000.00");
        Delegation old = new Delegation();
        old.setDelegatorId(o.manager().getId());
        old.setDelegateId(d.getId());
        old.setFromDate(today().minusDays(10));
        old.setToDate(today().minusDays(1));
        old.setCreatedAt(Instant.now());
        delegationRepo.save(old);

        assertThat(get("/api/approvals/inbox", token(d), 200)).isEmpty();
        get("/api/claims/" + id, token(d), 404);
        approve(id, d, 404);
    }

    @Test
    @DisplayName("TC-APR-10 a threshold change mid-flight does not change existing chains")
    void thresholdChangeMidFlight() throws Exception {
        Org o = org();
        long inFlight = submittedClaim(o.employee(), "15000.00");
        Employee fh = emp("EMPLOYEE,FINANCE_HEAD", null);
        post("/api/admin/approval-thresholds/AUDITOR/versions", token(fh),
                Map.of("minTotalExclusive", "10000.00", "reason", "Tighter control"), 201);
        try {
            approve(inFlight, o.manager(), 200);
            assertThat(status(inFlight)).isEqualTo("APPROVED");
            long fresh = submittedClaim(emp("EMPLOYEE", o.manager()), "15000.00");
            assertThat(levels(fresh, 1)).containsExactly("MANAGER", "AUDITOR");
            assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_event WHERE action = 'THRESHOLD_CHANGED'",
                    Long.class)).isPositive();
        } finally {
            post("/api/admin/approval-thresholds/AUDITOR/versions", token(fh),
                    Map.of("minTotalExclusive", "25000.00", "reason", "Restore"), 201);
        }
    }

    @Test
    @DisplayName("TC-APR-11 finance head's own claim: manager and FH steps go to the alternate approver")
    void financeHeadOwnClaim() throws Exception {
        Employee fh = emp("EMPLOYEE,FINANCE_HEAD", null);
        long id = submittedClaim(fh, "150000.00");
        Long alt = employees.findByEmpCode("EMP0002").orElseThrow().getId();
        List<Map<String, Object>> steps = jdbc.queryForList(
                "SELECT level, assignee_id FROM approval_step WHERE claim_id = ? ORDER BY seq", id);
        assertThat(steps).extracting(m -> m.get("level")).containsExactly("MANAGER", "AUDITOR", "FINANCE_HEAD");
        assertThat(((Number) steps.get(0).get("assignee_id")).longValue()).isEqualTo(alt);
        assertThat(((Number) steps.get(2).get("assignee_id")).longValue()).isEqualTo(alt);
        approve(id, fh, 403);
    }

    @Test
    @DisplayName("TC-APR-12 finance head reassigns a stuck step; audited; the new approver can act")
    void reassign() throws Exception {
        Org o = org();
        Employee other = emp("EMPLOYEE,MANAGER", null);
        long id = submittedClaim(o.employee(), "9000.00");
        long stepId = jdbc.queryForObject("SELECT id FROM approval_step WHERE claim_id = ? AND status = 'PENDING'",
                Long.class, id);
        post("/api/claims/" + id + "/steps/" + stepId + "/reassign", token(o.financeHead()),
                Map.of("assigneeId", o.employee().getId(), "reason", "x"), 422); // owner cannot be the approver
        post("/api/claims/" + id + "/steps/" + stepId + "/reassign", token(o.manager()),
                Map.of("assigneeId", other.getId(), "reason", "x"), 403);
        post("/api/claims/" + id + "/steps/" + stepId + "/reassign", token(o.financeHead()),
                Map.of("assigneeId", other.getId(), "reason", "Manager on leave, no delegate"), 200);
        assertThat(auditCount(id, "STEP_REASSIGNED")).isEqualTo(1);
        approve(id, o.manager(), 403);
        approve(id, other, 200);
        assertThat(status(id)).isEqualTo("APPROVED");
    }

    @Test
    @DisplayName("TC-SEC-01 claim splitting: 2 Ã— 20,000 within 7 days â†’ 2nd flagged SPLIT_SUSPECT with an auditor step")
    void claimSplitting() throws Exception {
        Org o = org();
        long first = submittedClaim(o.employee(), "20000.00");
        assertThat(levels(first, 1)).containsExactly("MANAGER");
        long second = submittedClaim(o.employee(), "20000.00");
        assertThat(levels(second, 1)).containsExactly("MANAGER", "AUDITOR");
        assertThat(jdbc.queryForObject("SELECT split_suspect FROM claim WHERE id = ?", Boolean.class, second)).isTrue();
        JsonNode q = get("/api/auditor/queue?status=PENDING_MANAGER&flag=SPLIT_SUSPECT&size=100", token(o.auditor()), 200);
        assertThat(q.findValues("claimId").stream().map(JsonNode::asLong)).contains(second).doesNotContain(first);
    }

    @Test
    @DisplayName("TC-SEC-02 self-approval via delegation: the delegate's own claim â†’ 403, step unchanged (R2)")
    void selfApprovalViaDelegation() throws Exception {
        Org o = org();
        long id = submittedClaim(o.employee(), "9000.00");
        post("/api/delegations", token(o.manager()), Map.of("delegateId", o.employee().getId(),
                "fromDate", today().toString(), "toDate", today().plusDays(2).toString()), 201);
        approve(id, o.employee(), 403);
        assertThat(status(id)).isEqualTo("PENDING_MANAGER");
        assertThat(get("/api/approvals/inbox", token(o.employee()), 200).findValues("claimId").stream()
                .map(JsonNode::asLong)).doesNotContain(id);
        assertThat(get("/api/claims/" + id, token(o.employee()), 200).at("/permissions/canApprove").asBoolean()).isFalse();
    }

    @Test
    @DisplayName("TC-SEC-03 delegation cycles Aâ†’Bâ†’A and Aâ†’Bâ†’Câ†’A are rejected (R3); self-delegation too")
    void delegationCycles() throws Exception {
        Employee a = emp("EMPLOYEE,MANAGER", null);
        Employee b = emp("EMPLOYEE,MANAGER", null);
        Employee c = emp("EMPLOYEE,MANAGER", null);
        Map<String, Object> dates = Map.of("fromDate", today().toString(), "toDate", today().plusDays(5).toString());
        post("/api/delegations", token(a), with(dates, "delegateId", b.getId()), 201);
        JsonNode cyc = post("/api/delegations", token(b), with(dates, "delegateId", a.getId()), 422);
        assertThat(cyc.get("code").asText()).isEqualTo("DELEGATION_CYCLE");
        post("/api/delegations", token(b), with(dates, "delegateId", c.getId()), 201);
        post("/api/delegations", token(c), with(dates, "delegateId", a.getId()), 422);
        post("/api/delegations", token(c), with(dates, "delegateId", c.getId()), 422);
        post("/api/delegations", token(emp("EMPLOYEE", null)), with(dates, "delegateId", a.getId()), 403);
    }

    @Test
    @DisplayName("BR-19 delegation does not chain: Aâ†’B and Bâ†’C does not let C act for A")
    void noChaining() throws Exception {
        Org o = org();
        Employee b = emp("EMPLOYEE,MANAGER", null);
        Employee c = emp("EMPLOYEE,MANAGER", null);
        long id = submittedClaim(o.employee(), "9000.00");
        Map<String, Object> dates = Map.of("fromDate", today().toString(), "toDate", today().plusDays(5).toString());
        post("/api/delegations", token(o.manager()), with(dates, "delegateId", b.getId()), 201);
        post("/api/delegations", token(b), with(dates, "delegateId", c.getId()), 201);
        approve(id, c, 404);
        approve(id, b, 200);
    }

    @Test
    @DisplayName("TC-SEC-06 approving via the API as a non-assignee â†’ 404 (cannot see) or 403 (can see) (R8)")
    void nonAssignee() throws Exception {
        Org o = org();
        long id = submittedClaim(o.employee(), "9000.00");
        approve(id, emp("EMPLOYEE,MANAGER", null), 404);
        approve(id, o.auditor(), 403); // auditors see every claim but this is a manager step
        approve(id, o.employee(), 403);
        assertThat(status(id)).isEqualTo("PENDING_MANAGER");
    }

    @RepeatedTest(5)
    @DisplayName("TC-SEC-07 concurrent approve from two tabs: one succeeds, one gets 409; one STEP_APPROVED row (R9)")
    void concurrentApprove() throws Exception {
        Org o = org();
        long id = submittedClaim(o.employee(), "9000.00");
        int v = claimVersion(id);
        String t = token(o.manager());
        CountDownLatch go = new CountDownLatch(1);
        Callable<Integer> task = () -> {
            go.await();
            return mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                            .post("/api/claims/" + id + "/approve")
                            .header("Authorization", "Bearer " + t)
                            .contentType("application/json")
                            .content("{\"version\":" + v + "}"))
                    .andReturn().getResponse().getStatus();
        };
        try (var pool = Executors.newFixedThreadPool(2)) {
            Future<Integer> f1 = pool.submit(task);
            Future<Integer> f2 = pool.submit(task);
            go.countDown();
            assertThat(List.of(f1.get(), f2.get())).containsExactlyInAnyOrder(200, 409);
        }
        assertThat(auditCount(id, "STEP_APPROVED")).isEqualTo(1);
        assertThat(status(id)).isEqualTo("APPROVED");
    }

    @Test
    @DisplayName("Stale version on approve â†’ 409 (BR-28)")
    void staleApprove() throws Exception {
        Org o = org();
        long id = submittedClaim(o.employee(), "9000.00");
        post("/api/claims/" + id + "/approve", token(o.manager()), Map.of("version", claimVersion(id) - 1), 409);
    }

    @Test
    @DisplayName("BR-05 an AUTO_APPROVE claim above the 5,000 cap is routed to the manager")
    void autoApproveAboveCap() throws Exception {
        Org o = org();
        long id = submittedClaim(o.employee(), "5000.01");
        assertThat(status(id)).isEqualTo("PENDING_MANAGER");
        long atCap = submittedClaim(emp("EMPLOYEE", o.manager()), "5000.00");
        assertThat(status(atCap)).isEqualTo("APPROVED");
    }

    @Test
    @DisplayName("BR-20 sampled auto-approved claim goes to PENDING_AUDITOR with sample_audit = true")
    void sampledClaim() throws Exception {
        Org o = org();
        jdbc.update("UPDATE app_config SET config_value = '1.00' WHERE config_key = 'sample_audit_rate'");
        long id;
        try {
            id = submittedClaim(o.employee(), "1200.00");
        } finally {
            jdbc.update("UPDATE app_config SET config_value = '0.00' WHERE config_key = 'sample_audit_rate'");
        }
        assertThat(status(id)).isEqualTo("PENDING_AUDITOR");
        assertThat(auditCount(id, "CLAIM_SAMPLED_FOR_AUDIT")).isEqualTo(1);
        JsonNode q = get("/api/auditor/queue?sample=true&size=100", token(o.auditor()), 200);
        assertThat(q.findValues("claimId").stream().map(JsonNode::asLong)).contains(id);
        approve(id, o.auditor(), 200);
        assertThat(status(id)).isEqualTo("APPROVED");
    }

    private static Map<String, Object> with(Map<String, Object> base, String k, Object v) {
        Map<String, Object> m = new java.util.HashMap<>(base);
        m.put(k, v);
        return m;
    }
}
