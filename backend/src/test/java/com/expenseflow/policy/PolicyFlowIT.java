package com.expenseflow.policy;

import com.expenseflow.claim.Category;
import com.expenseflow.claim.CityTier;
import com.expenseflow.support.IntegrationTest;
import com.expenseflow.user.Employee;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** Policy engine through the API and DB: persistence, cross-claim rules, config versioning. */
class PolicyFlowIT extends IntegrationTest {

    @Test
    @DisplayName("BR-14 one policy_result row per line per rule fired, with rule code and version")
    void resultsPersisted() throws Exception {
        String t = token(emp("EMPLOYEE", null));
        long id = createClaim(t, "Weekend dinner");
        java.time.LocalDate sat = today().minusDays(1);
        while (sat.getDayOfWeek() != java.time.DayOfWeek.SATURDAY) {
            sat = sat.minusDays(1);
        }
        long line = addLine(id, t, line(Category.MEAL, "1600.00", sat, "Dhaba", CityTier.OTHER, null));
        upload(id, line, t, png(), "bill.png", 201);
        JsonNode d = submit(id, t);
        assertThat(d.at("/claim/status").asText()).isEqualTo("PENDING_MANAGER");
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT rule_code, rule_version, outcome, flag, evaluation_no FROM policy_result WHERE claim_line_id = ? ORDER BY id", line);
        assertThat(rows).extracting(r -> r.get("rule_code")).containsExactly("MEAL_DAILY_LIMIT", "WEEKEND_SPEND");
        assertThat(rows).allSatisfy(r -> {
            assertThat(r.get("outcome")).isEqualTo("ROUTE");
            assertThat(((Number) r.get("evaluation_no")).intValue()).isEqualTo(1);
            assertThat(((Number) r.get("rule_version")).intValue()).isPositive();
        });
        assertThat(d.at("/lines/0/policyResults")).hasSize(2);
    }

    @Test
    @DisplayName("TC-POL-04 meals summed across claims: 800 in a submitted claim + 800 now → ROUTE OVER_LIMIT (R16)")
    void mealAcrossClaims() throws Exception {
        Employee e = emp("EMPLOYEE", null);
        String t = token(e);
        long first = createClaim(t, "Lunch");
        addReceiptedMeal(first, t, "800.00");
        submit(first, t);
        assertThat(status(first)).isEqualTo("APPROVED");

        long second = createClaim(t, "Dinner");
        long l2 = addReceiptedMeal(second, t, "800.00");
        submit(second, t);
        assertThat(status(second)).isEqualTo("PENDING_MANAGER");
        assertThat(jdbc.queryForList("SELECT flag FROM policy_result WHERE claim_line_id = ?", String.class, l2))
                .containsExactly("OVER_LIMIT");
    }

    private long addReceiptedMeal(long claimId, String t, String amount) throws Exception {
        long l = addLine(claimId, t, line(Category.MEAL, amount, weekday(), "Cafe " + amount + claimId, CityTier.OTHER, null));
        upload(claimId, l, t, png(), "m.png", 201);
        return l;
    }

    @Test
    @DisplayName("TC-POL-12 500.01 without receipt → POLICY_REJECTED with reason RECEIPT_REQUIRED")
    void receiptRequired() throws Exception {
        String t = token(emp("EMPLOYEE", null));
        long id = createClaim(t, "Stationery");
        addLine(id, t, line(Category.OTHER, "500.01", weekday(), "Shop", CityTier.OTHER, null));
        JsonNode d = submit(id, t);
        assertThat(d.at("/claim/status").asText()).isEqualTo("POLICY_REJECTED");
        assertThat(d.at("/lines/0/policyResults/0/reason").asText()).startsWith("RECEIPT_REQUIRED");
        assertThat(auditCount(id, "CLAIM_POLICY_REJECTED")).isEqualTo(1);
    }

    @Test
    @DisplayName("TC-POL-13 same receipt bytes uploaded by employee B under another name → DUPLICATE (R5)")
    void duplicateHashAcrossEmployees() throws Exception {
        byte[] bill = png();
        String ta = token(emp("EMPLOYEE", null));
        long a = createClaim(ta, "Laptop bag");
        long la = addLine(a, ta, line(Category.OTHER, "2400.00", weekday(), "Croma", CityTier.TIER_1, null));
        upload(a, la, ta, bill, "bag.png", 201);
        submit(a, ta);

        String tb = token(emp("EMPLOYEE", null));
        long b = createClaim(tb, "Bag");
        long lb = addLine(b, tb, line(Category.OTHER, "2399.00", weekday().minusDays(1), "Reliance", CityTier.TIER_1, null));
        upload(b, lb, tb, bill, "renamed-scan.png", 201);
        JsonNode d = submit(b, tb);
        assertThat(d.at("/claim/status").asText()).isEqualTo("PENDING_MANAGER");
        JsonNode r = d.at("/lines/0/policyResults/0");
        assertThat(r.get("ruleCode").asText()).isEqualTo("DUPLICATE_RECEIPT_HASH");
        assertThat(r.get("relatedLineId").asLong()).isEqualTo(la);
    }

    @Test
    @DisplayName("TC-POL-14 duplicate vendor+amount+date with a differently written vendor → DUPLICATE")
    void duplicateVendor() throws Exception {
        Employee e = emp("EMPLOYEE", null);
        String t = token(e);
        long a = createClaim(t, "Hotel 1");
        long la = addLine(a, t, line(Category.HOTEL, "4500.00", weekday(), "Taj Hotel", CityTier.TIER_1, 1));
        upload(a, la, t, png(), "a.png", 201);
        submit(a, t);
        long b = createClaim(t, "Hotel again");
        long lb = addLine(b, t, line(Category.HOTEL, "4500.00", weekday(), " taj  hotel.", CityTier.TIER_1, 1));
        upload(b, lb, t, png(), "b.png", 201);
        JsonNode d = submit(b, t);
        assertThat(d.at("/lines/0/policyResults/0/ruleCode").asText()).isEqualTo("DUPLICATE_VENDOR_AMOUNT_DATE");
        assertThat(d.at("/lines/0/policyResults/0/relatedLineId").asLong()).isEqualTo(la);
    }

    @Test
    @DisplayName("TC-POL-21 meal limit v2 = 2,000 via admin API → a 1,800 meal auto-approves; POLICY_RULE_CHANGED audited")
    void configChange() throws Exception {
        Employee fh = emp("EMPLOYEE,FINANCE_HEAD", null);
        String tfh = token(fh);
        String t = token(emp("EMPLOYEE", null));
        long before = createClaim(t, "Team dinner");
        addReceiptedMeal(before, t, "1800.00");
        submit(before, t);
        assertThat(status(before)).isEqualTo("PENDING_MANAGER");

        JsonNode v = post("/api/admin/policy-rules/MEAL_DAILY_LIMIT/versions", tfh,
                Map.of("limitAmount", "2000.00", "reason", "Inflation"), 201);
        try {
            assertThat(v.get("version").asInt()).isGreaterThanOrEqualTo(2);
            String t2 = token(emp("EMPLOYEE", null));
            long after = createClaim(t2, "Team dinner 2");
            long line = addReceiptedMeal(after, t2, "1800.00");
            submit(after, t2);
            assertThat(status(after)).isEqualTo("APPROVED");
            assertThat(jdbc.queryForObject("SELECT count(*) FROM policy_result WHERE claim_line_id = ?", Long.class, line))
                    .isZero();
            Map<String, Object> ev = jdbc.queryForMap("SELECT CAST(before AS text) b, CAST(after AS text) a "
                    + "FROM audit_event WHERE action = 'POLICY_RULE_CHANGED' AND entity_id = ?", v.get("id").asLong());
            assertThat((String) ev.get("b")).contains("1500.0");
            assertThat((String) ev.get("a")).contains("2000.0");
            JsonNode history = get("/api/admin/policy-rules?includeHistory=true", tfh, 200);
            assertThat(history.findValues("ruleCode").stream().filter(n -> n.asText().equals("MEAL_DAILY_LIMIT")).count())
                    .isGreaterThanOrEqualTo(2);
        } finally {
            post("/api/admin/policy-rules/MEAL_DAILY_LIMIT/versions", tfh,
                    Map.of("limitAmount", "1500.00", "reason", "Restore for other tests"), 201);
        }
    }

    @Test
    @DisplayName("TC-POL-22 rollback v3 → v2 creates v4 as a copy of v2, audited (EF-041)")
    void rollback() throws Exception {
        String tfh = token(emp("EMPLOYEE,FINANCE_HEAD", null));
        int v1 = post("/api/admin/policy-rules/CAB_TRIP_LIMIT/versions", tfh,
                Map.of("limitAmount", "2500.00", "reason", "Step A"), 201).get("version").asInt();
        post("/api/admin/policy-rules/CAB_TRIP_LIMIT/versions", tfh,
                Map.of("limitAmount", "3000.00", "reason", "Step B"), 201);
        JsonNode rb = post("/api/admin/policy-rules/CAB_TRIP_LIMIT/rollback", tfh,
                Map.of("toVersion", v1, "reason", "Step B was wrong"), 201);
        assertThat(rb.get("version").asInt()).isEqualTo(v1 + 2);
        assertThat(rb.get("limitAmount").decimalValue()).isEqualByComparingTo("2500.00");
        assertThat(rb.get("reason").asText()).contains("rollback to v" + v1);
        post("/api/admin/policy-rules/CAB_TRIP_LIMIT/rollback", tfh, Map.of("toVersion", 1, "reason", "Restore"), 201);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM policy_rule WHERE rule_code = 'CAB_TRIP_LIMIT' AND active",
                Long.class)).isEqualTo(1);
    }

    @Test
    @DisplayName("TC-SEC-05 finance head with own claim in flight cannot edit policy → 409, attempt audited (R7)")
    void editorWithClaimInFlight() throws Exception {
        Employee fh = emp("EMPLOYEE,FINANCE_HEAD", null);
        submittedClaim(fh, "9000.00");
        JsonNode err = post("/api/admin/policy-rules/MEAL_DAILY_LIMIT/versions", token(fh),
                Map.of("limitAmount", "9999.00", "reason", "Convenient"), 409);
        assertThat(err.get("code").asText()).isEqualTo("OWN_CLAIM_IN_FLIGHT");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_event WHERE action = 'POLICY_CHANGE_BLOCKED' AND actor_id = ?",
                Long.class, fh.getId())).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT limit_amount FROM policy_rule WHERE rule_code = 'MEAL_DAILY_LIMIT' AND active",
                java.math.BigDecimal.class)).isEqualByComparingTo("1500.00");
    }

    @Test
    @DisplayName("Policy admin: reason required (422); only finance head may write (403); auditor may read")
    void adminGuards() throws Exception {
        String tfh = token(emp("EMPLOYEE,FINANCE_HEAD", null));
        post("/api/admin/policy-rules/MEAL_DAILY_LIMIT/versions", tfh, Map.of("limitAmount", "1600.00"), 422);
        post("/api/admin/policy-rules/HOTEL_NIGHTLY_LIMIT/versions", tfh,
                Map.of("limitAmount", "6500.00", "reason", "needs key"), 422);
        String aud = token(emp("EMPLOYEE,AUDITOR", null));
        post("/api/admin/policy-rules/MEAL_DAILY_LIMIT/versions", aud, Map.of("limitAmount", "1.00", "reason", "x"), 403);
        assertThat(get("/api/admin/policy-rules", aud, 200).size()).isGreaterThanOrEqualTo(9);
        get("/api/admin/policy-rules", token(emp("EMPLOYEE", null)), 403);
    }
}
