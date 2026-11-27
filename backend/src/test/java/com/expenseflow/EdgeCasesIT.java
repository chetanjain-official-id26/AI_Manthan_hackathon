package com.expenseflow;

import com.expenseflow.claim.Category;
import com.expenseflow.claim.CityTier;
import com.expenseflow.common.error.ApiException;
import com.expenseflow.policy.ConfigService;
import com.expenseflow.support.IntegrationTest;
import com.expenseflow.user.Employee;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import tools.jackson.databind.JsonNode;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Error paths and options of the API that the feature suites do not exercise. */
class EdgeCasesIT extends IntegrationTest {

    @Autowired
    ConfigService config;

    private Map<String, Object> dates(int fromOffset, int toOffset) {
        Map<String, Object> m = new HashMap<>();
        m.put("fromDate", today().plusDays(fromOffset).toString());
        m.put("toDate", today().plusDays(toOffset).toString());
        return m;
    }

    @Nested
    class Claims {
        @Test
        @DisplayName("PATCH title: owner updates, stale version → 409, after submit → 422; audited")
        void updateTitle() throws Exception {
            String t = token(emp("EMPLOYEE", null));
            long id = createClaim(t, "Old");
            int v = version(id, t);
            JsonNode d = patch("/api/claims/" + id, t, Map.of("title", " New title ", "version", v), 200);
            assertThat(d.at("/claim/title").asText()).isEqualTo("New title");
            patch("/api/claims/" + id, t, Map.of("title", "x", "version", v), 409);
            assertThat(auditCount(id, "CLAIM_UPDATED")).isEqualTo(1);
            addLine(id, t, line(Category.MEAL, "100.00", weekday(), "Cafe", CityTier.OTHER, null));
            submit(id, t);
            patch("/api/claims/" + id, t, Map.of("title", "y", "version", version(id, t)), 422);
        }

        @Test
        @DisplayName("Comments: visible users can comment (audited); detail lists them with author names")
        void comments() throws Exception {
            Employee mgr = emp("EMPLOYEE,MANAGER", null);
            Employee e = emp("EMPLOYEE", mgr);
            long id = submittedClaim(e, "9000.00");
            JsonNode c = post("/api/claims/" + id + "/comments", token(mgr), Map.of("body", "  Which client?  "), 201);
            assertThat(c.get("body").asText()).isEqualTo("Which client?");
            post("/api/claims/" + id + "/comments", token(e), Map.of("body", "Acme"), 201);
            post("/api/claims/" + id + "/comments", token(e), Map.of("body", ""), 422);
            JsonNode d = get("/api/claims/" + id, token(e), 200);
            assertThat(d.get("comments")).hasSize(2);
            assertThat(d.at("/comments/0/authorName").asText()).isEqualTo(mgr.getName());
            assertThat(auditCount(id, "COMMENT_ADDED")).isEqualTo(2);
        }

        @Test
        @DisplayName("Copy only works on rejected claims; a manager-rejected claim can be copied")
        void copyRules() throws Exception {
            Employee mgr = emp("EMPLOYEE,MANAGER", null);
            Employee e = emp("EMPLOYEE", mgr);
            String t = token(e);
            long draft = createClaim(t, "Draft");
            post("/api/claims/" + draft + "/copy", t, null, 422);
            long id = submittedClaim(e, "9000.00");
            post("/api/claims/" + id + "/reject", token(mgr), Map.of("version", claimVersion(id), "reason", "No"), 200);
            JsonNode copy = post("/api/claims/" + id + "/copy", t, null, 201);
            assertThat(copy.at("/lines/0/receipt/sha256").asText()).hasSize(64);
        }

        @Test
        @DisplayName("Deleting a line with a receipt and replacing a receipt both work in a draft")
        void receiptReplaceAndDelete() throws Exception {
            String t = token(emp("EMPLOYEE", null));
            long id = createClaim(t, "Receipts");
            long line = addLine(id, t, line(Category.OTHER, "900.00", weekday(), "Shop", CityTier.OTHER, null));
            String first = upload(id, line, t, png(), "a.png", 201).get("sha256").asText();
            String second = upload(id, line, t, png(), "b.png", 201).get("sha256").asText();
            assertThat(second).isNotEqualTo(first);
            assertThat(get("/api/claims/" + id, t, 200).at("/lines/0/receipt/sha256").asText()).isEqualTo(second);
            call(MockMvcRequestBuilders.delete("/api/claims/" + id + "/lines/" + line), t, null, 204);
            call(MockMvcRequestBuilders.delete("/api/claims/" + id + "/lines/" + line), t, null, 404);
            upload(id, 999_999_999L, t, png(), "x.png", 404);
            get("/api/receipts/999999999", t, 404);
        }

        @Test
        @DisplayName("Submit: a line dated after 'today' (clock moved back) → 422; a submitted claim cannot be submitted again")
        void submitGuards() throws Exception {
            String t = token(emp("EMPLOYEE", null));
            long id = createClaim(t, "Future");
            addLine(id, t, line(Category.MEAL, "100.00", today(), "Cafe", CityTier.OTHER, null));
            clock.set(Instant.now().minus(Duration.ofDays(2)));
            JsonNode err = post("/api/claims/" + id + "/submit", t, Map.of("version", version(id, t)), 422);
            assertThat(err.get("errors").toString()).contains("future");
            clock.reset();
            submit(id, t);
            post("/api/claims/" + id + "/submit", t, Map.of("version", version(id, t)), 422);
        }

        @Test
        @DisplayName("Claim list: status filter, every whitelisted sort, bad page → 400; manager and delegate scopes")
        void listing() throws Exception {
            Employee mgr = emp("EMPLOYEE,MANAGER", null);
            Employee e = emp("EMPLOYEE", mgr);
            long a = submittedClaim(e, "9000.00");
            long b = submittedClaim(emp("EMPLOYEE", mgr), "300.00");
            String tm = token(mgr);
            for (String s : List.of("newest", "oldest", "submitted", "amount_desc", "amount_asc")) {
                get("/api/claims?sort=" + s, tm, 200);
            }
            JsonNode pending = get("/api/claims?status=PENDING_MANAGER", tm, 200);
            assertThat(pending.findValues("id").stream().map(JsonNode::asLong)).contains(a).doesNotContain(b);
            assertThat(get("/api/claims?sort=amount_desc", tm, 200).at("/content/0/id").asLong()).isEqualTo(a);
            assertThat(get("/api/claims?mine=true", tm, 200).get("totalElements").asLong()).isZero();
            get("/api/claims?size=0", tm, 400);
            get("/api/claims?page=-1", tm, 400);
            get("/api/claims?status=NOPE", tm, 400);

            Employee delegate = emp("EMPLOYEE", null);
            post("/api/delegations", tm, new HashMap<>(Map.of("delegateId", delegate.getId(), "fromDate",
                    today().toString(), "toDate", today().plusDays(1).toString())), 201);
            assertThat(get("/api/claims", token(delegate), 200).get("totalElements").asLong()).isEqualTo(2);
            JsonNode me = get("/api/me", token(delegate), 200);
            assertThat(me.at("/actingFor/0/delegatorId").asLong()).isEqualTo(mgr.getId());
        }
    }

    @Nested
    class Delegations {
        @Test
        @DisplayName("Validation: dates reversed / in the past, overlap, unknown delegate → 422")
        void validation() throws Exception {
            Employee m = emp("EMPLOYEE,MANAGER", null);
            Employee d = emp("EMPLOYEE", null);
            String t = token(m);
            Map<String, Object> rev = dates(3, 1);
            rev.put("delegateId", d.getId());
            post("/api/delegations", t, rev, 422);
            Map<String, Object> past = dates(-5, -1);
            past.put("delegateId", d.getId());
            post("/api/delegations", t, past, 422);
            Map<String, Object> unknown = dates(0, 1);
            unknown.put("delegateId", 999_999_999L);
            post("/api/delegations", t, unknown, 422);
            Map<String, Object> ok = dates(0, 3);
            ok.put("delegateId", d.getId());
            post("/api/delegations", t, ok, 201);
            Map<String, Object> overlap = dates(2, 5);
            overlap.put("delegateId", emp("EMPLOYEE", null).getId());
            assertThat(post("/api/delegations", t, overlap, 422).get("code").asText()).isEqualTo("DELEGATION_OVERLAP");
            assertThat(get("/api/delegations", t, 200)).hasSize(1);
            assertThat(get("/api/delegations", token(d), 200)).hasSize(1);
        }

        @Test
        @DisplayName("Revoke: other users get 404, finance head may revoke, revoking twice is a no-op")
        void revoke() throws Exception {
            Employee m = emp("EMPLOYEE,MANAGER", null);
            Map<String, Object> body = dates(0, 2);
            body.put("delegateId", emp("EMPLOYEE", null).getId());
            long id = post("/api/delegations", token(m), body, 201).get("id").asLong();
            call(MockMvcRequestBuilders.delete("/api/delegations/" + id), token(emp("EMPLOYEE,MANAGER", null)), null, 404);
            String fh = token(emp("EMPLOYEE,FINANCE_HEAD", null));
            call(MockMvcRequestBuilders.delete("/api/delegations/" + id), fh, null, 204);
            call(MockMvcRequestBuilders.delete("/api/delegations/" + id), fh, null, 204);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_event WHERE entity_type = 'DELEGATION' "
                    + "AND entity_id = ? AND action = 'DELEGATION_REVOKED'", Long.class, id)).isEqualTo(1);
        }

        @Test
        @DisplayName("Finance head creates a delegation for an absent approver (audited as by admin)")
        void adminDelegation() throws Exception {
            Employee absent = emp("EMPLOYEE,MANAGER", null);
            Employee d = emp("EMPLOYEE,MANAGER", null);
            Map<String, Object> body = dates(0, 2);
            body.put("delegatorId", absent.getId());
            body.put("delegateId", d.getId());
            body.put("reason", "On leave, no delegate set");
            long id = post("/api/admin/delegations", token(emp("EMPLOYEE,FINANCE_HEAD", null)), body, 201).get("id").asLong();
            assertThat(jdbc.queryForObject("SELECT action FROM audit_event WHERE entity_type = 'DELEGATION' AND entity_id = ?",
                    String.class, id)).isEqualTo("DELEGATION_CREATED_BY_ADMIN");
            body.put("delegatorId", 999_999_999L);
            post("/api/admin/delegations", token(emp("EMPLOYEE,FINANCE_HEAD", null)), body, 422);
            post("/api/admin/delegations", token(absent), body, 403);
        }
    }

    @Nested
    class Approvals {
        @Test
        @DisplayName("Reassign guards: blank reason, unknown step, inactive or wrong-role approver, non-pending step")
        void reassignGuards() throws Exception {
            Employee mgr = emp("EMPLOYEE,MANAGER", null);
            long id = submittedClaim(emp("EMPLOYEE", mgr), "9000.00");
            long step = jdbc.queryForObject("SELECT id FROM approval_step WHERE claim_id = ?", Long.class, id);
            String fh = token(emp("EMPLOYEE,FINANCE_HEAD", null));
            Employee other = emp("EMPLOYEE,MANAGER", null);
            String url = "/api/claims/" + id + "/steps/" + step + "/reassign";
            post(url, fh, Map.of("assigneeId", other.getId(), "reason", " "), 422);
            post("/api/claims/" + id + "/steps/999999999/reassign", fh, Map.of("assigneeId", other.getId(), "reason", "r"), 404);
            post(url, fh, Map.of("assigneeId", emp("EMPLOYEE", null).getId(), "reason", "r"), 422);
            Employee inactive = emp("EMPLOYEE,MANAGER", null);
            inactive.setActive(false);
            employees.save(inactive);
            post(url, fh, Map.of("assigneeId", inactive.getId(), "reason", "r"), 422);
            approve(id, mgr, 200);
            post(url, fh, Map.of("assigneeId", other.getId(), "reason", "r"), 422);
        }

        @Test
        @DisplayName("Approver actions on a claim that is not pending → 422; send-back needs a pending step too")
        void notPending() throws Exception {
            Employee e = emp("EMPLOYEE", null);
            long id = submittedClaim(e, "300.00"); // auto-approved
            Employee aud = emp("EMPLOYEE,AUDITOR", null);
            assertThat(post("/api/claims/" + id + "/approve", token(aud), Map.of("version", claimVersion(id)), 422)
                    .get("code").asText()).isEqualTo("NOT_PENDING");
            post("/api/claims/" + id + "/send-back", token(aud), Map.of("version", claimVersion(id), "comment", "x"), 422);
            post("/api/claims/" + id + "/reject", token(aud), Map.of("version", claimVersion(id), "reason", "x"), 422);
            get("/api/approvals/inbox?sort=amount", token(aud), 400);
        }

        @Test
        @DisplayName("No manager: steps go to the alternate approver, or to the finance-head pool if the owner is the alternate")
        void noManagerRouting() throws Exception {
            long id = submittedClaim(emp("EMPLOYEE", null), "9000.00");
            Long alt = employees.findByEmpCode("EMP0002").orElseThrow().getId();
            assertThat(jdbc.queryForObject("SELECT assignee_id FROM approval_step WHERE claim_id = ?", Long.class, id))
                    .isEqualTo(alt);
            Employee altEmp = employees.findById(alt).orElseThrow();
            long own = submittedClaim(altEmp, "9100.00");
            Map<String, Object> s = jdbc.queryForMap("SELECT assignee_id, assignee_role FROM approval_step WHERE claim_id = ?", own);
            assertThat(s.get("assignee_id")).isNull();
            assertThat(s.get("assignee_role")).isEqualTo("FINANCE_HEAD");
            approve(own, emp("EMPLOYEE,FINANCE_HEAD", null), 200);
            assertThat(status(own)).isEqualTo("APPROVED");
        }
    }

    @Nested
    class Admin {
        @Test
        @DisplayName("Policy admin: history listing, unknown rule 404, keyed hotel row, action/enabled/params/effectiveFrom, bad rollback 404")
        void policyAdmin() throws Exception {
            String fh = token(emp("EMPLOYEE,FINANCE_HEAD", null));
            JsonNode history = get("/api/admin/policy-rules?includeHistory=true", fh, 200);
            assertThat(history.size()).isGreaterThanOrEqualTo(9);
            post("/api/admin/policy-rules/NOPE/versions", fh, Map.of("reason", "x"), 404);

            Map<String, Object> hotel = new HashMap<>();
            hotel.put("category", "HOTEL");
            hotel.put("cityTier", "OTHER");
            hotel.put("limitAmount", "4100.00");
            hotel.put("reason", "Keyed row");
            JsonNode h = post("/api/admin/policy-rules/HOTEL_NIGHTLY_LIMIT/versions", fh, hotel, 201);
            assertThat(h.get("cityTier").asText()).isEqualTo("OTHER");

            Map<String, Object> weekend = new HashMap<>();
            weekend.put("action", "ROUTE");
            weekend.put("enabled", true);
            weekend.put("params", Map.of("weekendDays", List.of("SATURDAY", "SUNDAY")));
            weekend.put("effectiveFrom", "2020-01-02T00:00:00+05:30");
            weekend.put("reason", "Same values, new version");
            JsonNode w = post("/api/admin/policy-rules/WEEKEND_SPEND/versions", fh, weekend, 201);
            assertThat(w.get("effectiveFrom").asText()).startsWith("2020-01-02");
            post("/api/admin/policy-rules/WEEKEND_SPEND/rollback", fh, Map.of("toVersion", 99, "reason", "x"), 404);
            hotel.put("limitAmount", "4000.00");
            hotel.put("reason", "Restore");
            post("/api/admin/policy-rules/HOTEL_NIGHTLY_LIMIT/versions", fh, hotel, 201);
        }

        @Test
        @DisplayName("Thresholds: list, unknown level → 404; config versions need a reason and are audited")
        void thresholdsAndConfig() throws Exception {
            String fh = token(emp("EMPLOYEE,FINANCE_HEAD", null));
            assertThat(get("/api/admin/approval-thresholds", fh, 200)).hasSize(3);
            post("/api/admin/approval-thresholds/CEO/versions", fh, Map.of("minTotalExclusive", "1.00", "reason", "x"), 404);

            assertThatThrownBy(() -> config.set("test_key", "1", null, " ")).isInstanceOf(ApiException.class);
            config.set("test_key", "1", null, "first");
            config.set("test_key", "2", null, "second");
            assertThat(config.get("test_key")).isEqualTo("2");
            assertThat(config.integer("test_key")).isEqualTo(2);
            assertThat(config.find("missing_key")).isEmpty();
            assertThatThrownBy(() -> config.get("missing_key")).isInstanceOf(IllegalStateException.class);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_event WHERE action = 'CONFIG_CHANGED' "
                    + "AND after->>'key' = 'test_key'", Long.class)).isEqualTo(2);
            assertThat(get("/api/dashboard/rule-changes", fh, 200).size()).isPositive();
        }

        @Test
        @DisplayName("Audit search: action, actor, date range filters; bad page → 400")
        void auditFilters() throws Exception {
            Employee e = emp("EMPLOYEE", null);
            long id = submittedClaim(e, "300.00");
            String aud = token(emp("EMPLOYEE,AUDITOR", null));
            String base = "/api/audit?claimId=" + id;
            assertThat(get(base + "&action=CLAIM_SUBMITTED", aud, 200).get("totalElements").asLong()).isEqualTo(1);
            assertThat(get(base + "&from=" + today().minusDays(1) + "&to=" + today(), aud, 200).get("totalElements").asLong())
                    .isPositive();
            assertThat(get(base + "&from=" + today().plusDays(1), aud, 200).get("totalElements").asLong()).isZero();
            assertThat(get("/api/audit?actorId=" + e.getId() + "&action=", aud, 200).get("totalElements").asLong()).isPositive();
            get("/api/audit?size=500", aud, 400);
        }

        @Test
        @DisplayName("Dashboard and auditor queue accept date ranges, sample=false, all sorts; bad page → 400")
        void queriesWithOptions() throws Exception {
            String fh = token(emp("EMPLOYEE,FINANCE_HEAD", null));
            String range = "?from=" + today().minusDays(30) + "&to=" + today();
            get("/api/dashboard/spend-by-category" + range, fh, 200);
            get("/api/dashboard/spend-by-department" + range, fh, 200);
            get("/api/dashboard/violations" + range, fh, 200);
            for (String s : List.of("age", "amount_desc", "amount_asc", "submitted_desc")) {
                get("/api/auditor/queue?sort=" + s + "&sample=false&min=1&max=999999", fh, 200);
            }
            get("/api/auditor/queue?size=101", fh, 400);
        }
    }

    @Nested
    class Payouts {
        @Test
        @DisplayName("Payout guards: empty list, unknown claim, export of a voided batch, stale mark-paid; list batches")
        void guards() throws Exception {
            String fh = token(emp("EMPLOYEE,FINANCE_HEAD", null));
            post("/api/payouts", fh, Map.of("claimIds", List.of()), 422);
            post("/api/payouts", fh, Map.of("claimIds", List.of(999_999_999L)), 404);
            get("/api/payouts/999999999", fh, 404);

            long a = submittedClaim(emp("EMPLOYEE", null), "400.00");
            long b = submittedClaim(emp("EMPLOYEE", null), "450.00");
            long batch = post("/api/payouts", fh, Map.of("claimIds", List.of(a)), 201).get("id").asLong();
            post("/api/payouts/" + batch + "/void", fh, Map.of("reason", "wrong"), 200);
            call(MockMvcRequestBuilders.get("/api/payouts/" + batch + "/csv"), fh, null, 422);
            post("/api/payouts/" + batch + "/void", fh, Map.of("reason", "again"), 422);

            long b2 = post("/api/payouts", fh, Map.of("claimIds", List.of(a, b)), 201).get("id").asLong();
            call(MockMvcRequestBuilders.get("/api/payouts/" + b2 + "/csv"), fh, null, 200);
            int v = get("/api/payouts/" + b2, fh, 200).get("version").asInt();
            post("/api/payouts/" + b2 + "/mark-paid", fh, Map.of("version", v - 1), 409);
            JsonNode list = get("/api/payouts", fh, 200);
            assertThat(list.findValues("id").stream().map(JsonNode::asLong)).contains(batch, b2);
        }
    }
}
