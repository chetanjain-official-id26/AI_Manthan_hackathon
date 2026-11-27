package com.expenseflow.approval;

import com.expenseflow.claim.Category;
import com.expenseflow.claim.CityTier;
import com.expenseflow.support.IntegrationTest;
import com.expenseflow.user.Department;
import com.expenseflow.user.Employee;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** Auditor queue, bulk approve and audit viewer (Test Plan §7.3). */
class AuditorQueueIT extends IntegrationTest {

    /** Submits a claim for a fresh reportee and gets it through the manager step to PENDING_AUDITOR. */
    private long atAuditor(Employee mgr, Department d, String amount) throws Exception {
        Employee e = emp("EMPLOYEE", mgr, d);
        long id = submittedClaim(e, amount);
        approve(id, mgr, 200);
        assertThat(status(id)).isEqualTo("PENDING_AUDITOR");
        return id;
    }

    @Test
    @DisplayName("TC-AUD-01 filters (dept, category, amount, flag, age) and paging; counts match SQL; bad sort → 400")
    void filters() throws Exception {
        Employee mgr = emp("EMPLOYEE,MANAGER", null);
        Employee aud = emp("EMPLOYEE,AUDITOR", null);
        Department fin = dept("FINQ" + System.nanoTime() % 100000);
        long a = atAuditor(mgr, fin, "30000.00");
        long b = atAuditor(mgr, fin, "45000.00");

        // a claim with a flagged hotel line for the DUPLICATE/OVER_LIMIT filter
        Employee e = emp("EMPLOYEE", mgr, fin);
        String t = token(e);
        long c = createClaim(t, "Big hotel");
        long l = addLine(c, t, line(Category.HOTEL, "36000.00", weekday(), "Grand", CityTier.TIER_1, 3));
        upload(c, l, t, png(), "h.png", 201);
        submit(c, t);
        approve(c, mgr, 200);

        String ta = token(aud);
        JsonNode byDept = get("/api/auditor/queue?dept=" + fin.getCode() + "&size=100", ta, 200);
        assertThat(byDept.get("totalElements").asLong()).isEqualTo(3);
        Long sql = jdbc.queryForObject("SELECT count(*) FROM claim c JOIN employee e ON e.id = c.employee_id "
                + "JOIN department d ON d.id = e.department_id WHERE c.status = 'PENDING_AUDITOR' AND d.code = ?",
                Long.class, fin.getCode());
        assertThat(byDept.get("totalElements").asLong()).isEqualTo(sql);

        JsonNode overLimit = get("/api/auditor/queue?dept=" + fin.getCode() + "&flag=OVER_LIMIT", ta, 200);
        assertThat(overLimit.get("totalElements").asLong()).isEqualTo(1);
        assertThat(overLimit.at("/content/0/claimId").asLong()).isEqualTo(c);
        assertThat(texts(overLimit.at("/content/0/flags"))).contains("OVER_LIMIT");

        JsonNode hotels = get("/api/auditor/queue?dept=" + fin.getCode() + "&category=HOTEL", ta, 200);
        assertThat(hotels.get("totalElements").asLong()).isEqualTo(1);

        JsonNode range = get("/api/auditor/queue?dept=" + fin.getCode() + "&min=40000&max=50000", ta, 200);
        assertThat(range.get("totalElements").asLong()).isEqualTo(1);
        assertThat(range.at("/content/0/claimId").asLong()).isEqualTo(b);

        JsonNode paged = get("/api/auditor/queue?dept=" + fin.getCode() + "&size=2&page=1&sort=amount_desc", ta, 200);
        assertThat(paged.get("content")).hasSize(1);
        assertThat(paged.at("/content/0/claimId").asLong()).isEqualTo(a);

        assertThat(get("/api/auditor/queue?dept=" + fin.getCode() + "&ageDays=1", ta, 200).get("totalElements").asLong())
                .isZero();

        get("/api/auditor/queue?sort=total_amount", ta, 400);
        get("/api/auditor/queue?flag=NOPE", ta, 400);
        get("/api/auditor/queue", token(emp("EMPLOYEE,MANAGER", null)), 403);
    }

    @Test
    @DisplayName("TC-AUD-02 bulk approve 5 where 1 is stale and 1 is self-owned → 3 OK, 2 failed; 3 audit rows")
    void bulkApprove() throws Exception {
        Employee mgr = emp("EMPLOYEE,MANAGER", null);
        Employee aud = emp("EMPLOYEE,AUDITOR", mgr); // the auditor also files claims through the same manager
        Department d = dept("ENG");
        List<Long> ok = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            ok.add(atAuditor(mgr, d, "26000.0" + i));
        }
        long own = submittedClaim(aud, "27000.00");
        approve(own, mgr, 200);

        long stale = ok.remove(3);
        List<Map<String, Object>> items = new ArrayList<>();
        for (long id : ok) {
            items.add(Map.of("claimId", id, "version", claimVersion(id)));
        }
        items.add(Map.of("claimId", stale, "version", claimVersion(stale) - 1));
        items.add(Map.of("claimId", own, "version", claimVersion(own)));

        JsonNode res = post("/api/auditor/bulk-approve", token(aud), Map.of("items", items), 200);
        assertThat(res).hasSize(5);
        long approved = 0;
        for (JsonNode r : res) {
            if (r.get("result").asText().equals("APPROVED")) {
                approved++;
            }
        }
        assertThat(approved).isEqualTo(3);
        assertThat(res.get(3).get("errorCode").asText()).isEqualTo("STALE_VERSION");
        assertThat(res.get(4).get("errorCode").asText()).isEqualTo("FORBIDDEN");
        for (long id : ok) {
            assertThat(status(id)).isEqualTo("APPROVED");
            assertThat(auditCount(id, "STEP_APPROVED")).isEqualTo(2);
        }
        assertThat(status(stale)).isEqualTo("PENDING_AUDITOR");
        assertThat(status(own)).isEqualTo("PENDING_AUDITOR");
    }

    @Test
    @DisplayName("Bulk approve: more than 100 items → 400; finance head (not auditor) → 403")
    void bulkLimits() throws Exception {
        Employee aud = emp("EMPLOYEE,AUDITOR", null);
        List<Map<String, Object>> many = new ArrayList<>();
        for (int i = 0; i < 101; i++) {
            many.add(Map.of("claimId", i + 1, "version", 0));
        }
        post("/api/auditor/bulk-approve", token(aud), Map.of("items", many), 400);
        post("/api/auditor/bulk-approve", token(emp("EMPLOYEE,FINANCE_HEAD", null)),
                Map.of("items", List.of(Map.of("claimId", 1, "version", 0))), 403);
    }

    @Test
    @DisplayName("TC-AUD-04 audit viewer filters by claim and actor, in time order, with on-behalf-of")
    void auditViewer() throws Exception {
        Employee mgr = emp("EMPLOYEE,MANAGER", null);
        Employee delegate = emp("EMPLOYEE,MANAGER", null);
        Employee e = emp("EMPLOYEE", mgr);
        long id = submittedClaim(e, "9000.00");
        post("/api/delegations", token(mgr), Map.of("delegateId", delegate.getId(), "fromDate", today().toString(),
                "toDate", today().plusDays(1).toString()), 201);
        approve(id, delegate, 200);

        String aud = token(emp("EMPLOYEE,AUDITOR", null));
        JsonNode events = get("/api/audit?claimId=" + id, aud, 200).get("content");
        List<String> actions = new ArrayList<>();
        events.forEach(n -> actions.add(n.get("action").asText()));
        assertThat(actions).containsSubsequence("CLAIM_CREATED", "LINE_ADDED", "RECEIPT_UPLOADED", "CLAIM_SUBMITTED",
                "POLICY_EVALUATED", "APPROVAL_CHAIN_CREATED", "STEP_APPROVED", "CLAIM_APPROVED");
        JsonNode stepApproved = null;
        for (JsonNode n : events) {
            if (n.get("action").asText().equals("STEP_APPROVED")) {
                stepApproved = n;
            }
        }
        assertThat(stepApproved).isNotNull();
        assertThat(stepApproved.get("actorId").asLong()).isEqualTo(delegate.getId());
        assertThat(stepApproved.get("onBehalfOfId").asLong()).isEqualTo(mgr.getId());
        assertThat(stepApproved.at("/before/status").asText()).isEqualTo("PENDING");
        assertThat(stepApproved.get("createdAt").asText()).endsWith("+05:30");

        JsonNode byActor = get("/api/audit?actorId=" + delegate.getId(), aud, 200);
        assertThat(byActor.get("totalElements").asLong()).isGreaterThanOrEqualTo(2);

        assertThat(get("/api/audit?claimId=" + id, token(e), 200).get("totalElements").asLong()).isPositive();
        get("/api/audit", token(e), 403);
    }
}
