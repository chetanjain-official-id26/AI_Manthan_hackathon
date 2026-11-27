package com.expenseflow.dashboard;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/**
 * Aggregate queries for the dashboard (EF-029, EF-030). "Spend" is approved money: claims in
 * APPROVED, IN_PAYOUT or PAID. Optional filters are constant SQL fragments with bound values.
 */
@Repository
public class DashboardRepository {

    static final String SPENT = "c.status IN ('APPROVED','IN_PAYOUT','PAID')";

    private final NamedParameterJdbcTemplate jdbc;

    public DashboardRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Null managerId = all employees; otherwise only that manager's direct reportees. */
    public record Scope(Long managerId, LocalDate from, LocalDate to) {
    }

    public record Amount(String key, BigDecimal total) {
    }

    public record Count(String key, long count) {
    }

    public record Hours(String key, BigDecimal avgHours, long claims) {
    }

    private String filters(Scope s, MapSqlParameterSource p, boolean byExpenseDate) {
        StringBuilder sb = new StringBuilder();
        if (s.managerId() != null) {
            sb.append(" AND e.manager_id = :managerId");
            p.addValue("managerId", s.managerId());
        }
        if (byExpenseDate && s.from() != null) {
            sb.append(" AND l.expense_date >= :from");
            p.addValue("from", s.from());
        }
        if (byExpenseDate && s.to() != null) {
            sb.append(" AND l.expense_date <= :to");
            p.addValue("to", s.to());
        }
        return sb.toString();
    }

    public List<Amount> spendByCategory(Scope s) {
        MapSqlParameterSource p = new MapSqlParameterSource();
        String sql = "SELECT l.category AS k, SUM(l.amount) AS total FROM claim_line l "
                + "JOIN claim c ON c.id = l.claim_id JOIN employee e ON e.id = c.employee_id WHERE " + SPENT
                + filters(s, p, true) + " GROUP BY l.category ORDER BY total DESC";
        return jdbc.query(sql, p, (rs, i) -> new Amount(rs.getString("k"), rs.getBigDecimal("total")));
    }

    public List<Amount> spendByDepartment(Scope s) {
        MapSqlParameterSource p = new MapSqlParameterSource();
        String sql = "SELECT COALESCE(d.name, 'Unassigned') AS k, SUM(l.amount) AS total FROM claim_line l "
                + "JOIN claim c ON c.id = l.claim_id JOIN employee e ON e.id = c.employee_id "
                + "LEFT JOIN department d ON d.id = e.department_id WHERE " + SPENT + filters(s, p, true)
                + " GROUP BY d.name ORDER BY total DESC";
        return jdbc.query(sql, p, (rs, i) -> new Amount(rs.getString("k"), rs.getBigDecimal("total")));
    }

    /** Exactly 12 monthly buckets ending with {@code today}'s month, zero-filled. */
    public List<Amount> spendByMonth(Scope s, LocalDate today) {
        MapSqlParameterSource p = new MapSqlParameterSource().addValue("today", today);
        String sql = "WITH months AS (SELECT generate_series(date_trunc('month', CAST(:today AS date)) - interval '11 months', "
                + "date_trunc('month', CAST(:today AS date)), interval '1 month')::date AS m) "
                + "SELECT to_char(months.m, 'YYYY-MM') AS k, COALESCE(SUM(x.amount), 0) AS total FROM months "
                + "LEFT JOIN (SELECT l.amount, date_trunc('month', l.expense_date)::date AS m FROM claim_line l "
                + "JOIN claim c ON c.id = l.claim_id JOIN employee e ON e.id = c.employee_id WHERE " + SPENT
                + filters(new Scope(s.managerId(), null, null), p, false) + ") x ON x.m = months.m "
                + "GROUP BY months.m ORDER BY months.m";
        return jdbc.query(sql, p, (rs, i) -> new Amount(rs.getString("k"), rs.getBigDecimal("total")));
    }

    /** Rules that fired with a non-approve outcome, on the latest evaluation of each claim. */
    public List<Count> violations(Scope s) {
        MapSqlParameterSource p = new MapSqlParameterSource();
        String sql = "SELECT pr.rule_code AS k, COUNT(*) AS n FROM policy_result pr "
                + "JOIN claim_line l ON l.id = pr.claim_line_id JOIN claim c ON c.id = l.claim_id "
                + "JOIN employee e ON e.id = c.employee_id "
                + "WHERE pr.outcome <> 'AUTO_APPROVE' AND pr.evaluation_no = c.cycle_no" + filters(s, p, true)
                + " GROUP BY pr.rule_code ORDER BY n DESC";
        return jdbc.query(sql, p, (rs, i) -> new Count(rs.getString("k"), rs.getLong("n")));
    }

    /** Average submit → final approval time for claims that went through at least one human step. */
    public List<Hours> approvalTime(Scope s) {
        MapSqlParameterSource p = new MapSqlParameterSource();
        StringBuilder f = new StringBuilder();
        if (s.managerId() != null) {
            f.append(" AND e.manager_id = :managerId");
            p.addValue("managerId", s.managerId());
        }
        String sql = "SELECT COALESCE(d.name, 'Unassigned') AS k, "
                + "ROUND(CAST(AVG(EXTRACT(EPOCH FROM (c.approved_at - c.submitted_at)) / 3600.0) AS numeric), 2) AS h, "
                + "COUNT(*) AS n FROM claim c JOIN employee e ON e.id = c.employee_id "
                + "LEFT JOIN department d ON d.id = e.department_id "
                + "WHERE c.approved_at IS NOT NULL AND c.submitted_at IS NOT NULL "
                + "AND EXISTS (SELECT 1 FROM approval_step s WHERE s.claim_id = c.id AND s.status = 'APPROVED' "
                + "AND s.cycle_no = c.cycle_no)" + f + " GROUP BY d.name ORDER BY d.name";
        return jdbc.query(sql, p, (rs, i) -> new Hours(rs.getString("k"), rs.getBigDecimal("h"), rs.getLong("n")));
    }

    public record RuleChange(Long eventId, String action, Long actorId, String after, java.time.Instant at) {
    }

    /** R7: recent policy and threshold changes are visible on the dashboard. */
    public List<RuleChange> recentRuleChanges(int limit) {
        return jdbc.query("SELECT id, action, actor_id, CAST(after AS text) AS after, created_at FROM audit_event "
                        + "WHERE action IN ('POLICY_RULE_CHANGED','THRESHOLD_CHANGED','CONFIG_CHANGED') "
                        + "ORDER BY created_at DESC, id DESC LIMIT :limit",
                new MapSqlParameterSource("limit", limit),
                (rs, i) -> new RuleChange(rs.getLong("id"), rs.getString("action"), rs.getLong("actor_id"),
                        rs.getString("after"), rs.getTimestamp("created_at").toInstant()));
    }
}
