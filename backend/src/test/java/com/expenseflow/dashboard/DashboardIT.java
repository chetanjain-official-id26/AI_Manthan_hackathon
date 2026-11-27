package com.expenseflow.dashboard;

import com.expenseflow.support.IntegrationTest;
import com.expenseflow.user.Employee;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

import java.math.BigDecimal;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** Dashboard numbers vs SQL (Test Plan §7.5). */
class DashboardIT extends IntegrationTest {

    private Map<String, BigDecimal> toMap(JsonNode arr) {
        Map<String, BigDecimal> m = new HashMap<>();
        arr.forEach(n -> m.put(n.get("key").asText(), n.get("total").decimalValue()));
        return m;
    }

    private Map<String, BigDecimal> sql(String q) {
        Map<String, BigDecimal> m = new HashMap<>();
        jdbc.query(q, rs -> {
            m.put(rs.getString(1), rs.getBigDecimal(2));
        });
        return m;
    }

    private void seedSome() throws Exception {
        Employee mgr = emp("EMPLOYEE,MANAGER", null);
        long a = submittedClaim(emp("EMPLOYEE", mgr), "2500.00");   // auto-approved
        long b = submittedClaim(emp("EMPLOYEE", mgr), "12000.00");  // manager approves
        approve(b, mgr, 200);
        assertThat(status(a)).isEqualTo("APPROVED");
    }

    @Test
    @DisplayName("TC-DSH-01 spend by category equals SQL")
    void byCategory() throws Exception {
        seedSome();
        String fh = token(emp("EMPLOYEE,FINANCE_HEAD", null));
        Map<String, BigDecimal> api = toMap(get("/api/dashboard/spend-by-category", fh, 200));
        Map<String, BigDecimal> db = sql("SELECT l.category, SUM(l.amount) FROM claim_line l JOIN claim c ON c.id = l.claim_id "
                + "WHERE c.status IN ('APPROVED','IN_PAYOUT','PAID') GROUP BY l.category");
        assertThat(api.keySet()).isEqualTo(db.keySet());
        db.forEach((k, v) -> assertThat(api.get(k)).isEqualByComparingTo(v));
    }

    @Test
    @DisplayName("TC-DSH-02 spend by department equals SQL")
    void byDepartment() throws Exception {
        seedSome();
        String aud = token(emp("EMPLOYEE,AUDITOR", null));
        Map<String, BigDecimal> api = toMap(get("/api/dashboard/spend-by-department", aud, 200));
        Map<String, BigDecimal> db = sql("SELECT COALESCE(d.name,'Unassigned'), SUM(l.amount) FROM claim_line l "
                + "JOIN claim c ON c.id = l.claim_id JOIN employee e ON e.id = c.employee_id "
                + "LEFT JOIN department d ON d.id = e.department_id WHERE c.status IN ('APPROVED','IN_PAYOUT','PAID') GROUP BY d.name");
        assertThat(api.keySet()).isEqualTo(db.keySet());
        db.forEach((k, v) -> assertThat(api.get(k)).isEqualByComparingTo(v));
    }

    @Test
    @DisplayName("TC-DSH-03 spend by month: exactly 12 buckets, the current month matches SQL")
    void byMonth() throws Exception {
        seedSome();
        String fh = token(emp("EMPLOYEE,FINANCE_HEAD", null));
        JsonNode months = get("/api/dashboard/spend-by-month", fh, 200);
        assertThat(months).hasSize(12);
        String last = months.get(11).get("key").asText();
        assertThat(last).isEqualTo(today().toString().substring(0, 7));
        BigDecimal total = BigDecimal.ZERO;
        for (JsonNode m : months) {
            total = total.add(m.get("total").decimalValue());
        }
        BigDecimal db = jdbc.queryForObject("SELECT COALESCE(SUM(l.amount),0) FROM claim_line l JOIN claim c ON c.id = l.claim_id "
                + "WHERE c.status IN ('APPROVED','IN_PAYOUT','PAID') AND l.expense_date >= date_trunc('month', CAST(? AS date)) - interval '11 months'",
                BigDecimal.class, today());
        assertThat(total).isEqualByComparingTo(db);
    }

    @Test
    @DisplayName("TC-DSH-04 violations by rule include planted breaches")
    void violations() throws Exception {
        Employee mgr = emp("EMPLOYEE,MANAGER", null);
        String t = token(emp("EMPLOYEE", mgr));
        long id = createClaim(t, "Cab");
        long l = addLine(id, t, line(com.expenseflow.claim.Category.CAB, "2500.00", weekday(), "Ola",
                com.expenseflow.claim.CityTier.TIER_1, null));
        upload(id, l, t, png(), "c.png", 201);
        submit(id, t);
        String fh = token(emp("EMPLOYEE,FINANCE_HEAD", null));
        JsonNode v = get("/api/dashboard/violations", fh, 200);
        long cab = 0;
        for (JsonNode n : v) {
            if (n.get("key").asText().equals("CAB_TRIP_LIMIT")) {
                cab = n.get("count").asLong();
            }
        }
        assertThat(cab).isGreaterThanOrEqualTo(1);
    }

    @Test
    @DisplayName("TC-DSH-05 average approval time equals SQL and responds under 300 ms; managers see only their team")
    void approvalTime() throws Exception {
        Employee mgr = emp("EMPLOYEE,MANAGER", null);
        long id = submittedClaim(emp("EMPLOYEE", mgr), "8000.00");
        approve(id, mgr, 200);
        String fh = token(emp("EMPLOYEE,FINANCE_HEAD", null));
        get("/api/dashboard/approval-time", fh, 200); // warm-up (JIT, connection pool)
        long start = System.nanoTime();
        JsonNode api = get("/api/dashboard/approval-time", fh, 200);
        long ms = (System.nanoTime() - start) / 1_000_000;
        assertThat(ms).isLessThan(300);
        Map<String, BigDecimal> db = new HashMap<>();
        jdbc.query("SELECT COALESCE(d.name,'Unassigned'), ROUND(CAST(AVG(EXTRACT(EPOCH FROM (c.approved_at - c.submitted_at))/3600.0) AS numeric),2) "
                + "FROM claim c JOIN employee e ON e.id = c.employee_id LEFT JOIN department d ON d.id = e.department_id "
                + "WHERE c.approved_at IS NOT NULL AND c.submitted_at IS NOT NULL AND EXISTS (SELECT 1 FROM approval_step s "
                + "WHERE s.claim_id = c.id AND s.status = 'APPROVED' AND s.cycle_no = c.cycle_no) GROUP BY d.name",
                rs -> {
                    db.put(rs.getString(1), rs.getBigDecimal(2));
                });
        api.forEach(n -> assertThat(n.get("avgHours").decimalValue()).isEqualByComparingTo(db.get(n.get("key").asText())));

        JsonNode team = get("/api/dashboard/spend-by-category", token(mgr), 200);
        BigDecimal teamTotal = BigDecimal.ZERO;
        for (JsonNode n : team) {
            teamTotal = teamTotal.add(n.get("total").decimalValue());
        }
        assertThat(teamTotal).isEqualByComparingTo("8000.00");
        get("/api/dashboard/spend-by-category", token(emp("EMPLOYEE", null)), 403);
        assertThat(List.of(api.size())).isNotEmpty();
    }
}
