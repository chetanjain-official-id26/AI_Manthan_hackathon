package com.expenseflow.approval;

import com.expenseflow.claim.Category;
import com.expenseflow.claim.ClaimStatus;
import com.expenseflow.common.error.ApiException;
import com.expenseflow.common.time.Ist;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.Set;

/**
 * Auditor queue (EF-023). Filters are bound parameters and the ORDER BY comes from a whitelist enum;
 * no user text is ever concatenated into SQL (CLAUDE.md rule 10).
 */
@Component
public class AuditorQueueQuery {

    public static final Set<String> FLAGS = Set.of("OVER_LIMIT", "DUPLICATE", "WEEKEND", "RECEIPT", "STALE",
            "SPLIT_SUSPECT");

    public enum QueueSort {
        AGE("s.activated_at ASC NULLS LAST, c.id ASC"),
        AMOUNT_DESC("c.total_amount DESC, c.id ASC"),
        AMOUNT_ASC("c.total_amount ASC, c.id ASC"),
        SUBMITTED_DESC("c.submitted_at DESC, c.id DESC");

        private final String orderBy;

        QueueSort(String orderBy) {
            this.orderBy = orderBy;
        }

        public static QueueSort parse(String s) {
            if (s == null || s.isBlank()) {
                return AGE;
            }
            return Arrays.stream(values()).filter(v -> v.name().equalsIgnoreCase(s.trim())).findFirst()
                    .orElseThrow(() -> ApiException.badRequest("INVALID_SORT",
                            "Unsupported sort: allowed values are " + List.of(values())));
        }
    }

    public record Filter(ClaimStatus status, String dept, Category category, BigDecimal min, BigDecimal max,
                         String flag, Boolean sample, Integer ageDays, QueueSort sort, int page, int size) {
    }

    public record Row(Long claimId, String claimNo, String title, Long employeeId, String employeeName,
                      String department, BigDecimal totalAmount, String status, boolean sampleAudit,
                      boolean splitSuspect, List<String> flags, OffsetDateTime submittedAt,
                      OffsetDateTime pendingSince, long ageHours, int version) {
    }

    public record Result(List<Row> content, int page, int size, long totalElements) {
    }

    private static final String FROM = """
            FROM claim c
            JOIN employee e ON e.id = c.employee_id
            LEFT JOIN department d ON d.id = e.department_id
            LEFT JOIN approval_step s ON s.claim_id = c.id AND s.status = 'PENDING'
            WHERE c.status = :status
            """;

    private static final String FLAG_EXISTS = """
             AND (EXISTS (SELECT 1 FROM policy_result pr JOIN claim_line l ON l.id = pr.claim_line_id
                          WHERE l.claim_id = c.id AND pr.evaluation_no = c.cycle_no AND pr.flag = :flag)
                  OR (:flag = 'SPLIT_SUSPECT' AND c.split_suspect))
            """;

    private final NamedParameterJdbcTemplate jdbc;
    private final Clock clock;

    public AuditorQueueQuery(NamedParameterJdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    public Result find(Filter f) {
        if (f.page() < 0 || f.size() < 1 || f.size() > 100) {
            throw ApiException.badRequest("INVALID_PAGE", "page must be ≥ 0 and size between 1 and 100");
        }
        if (f.flag() != null && !FLAGS.contains(f.flag())) {
            throw ApiException.badRequest("INVALID_FLAG", "Unsupported flag: allowed values are " + FLAGS);
        }
        MapSqlParameterSource p = new MapSqlParameterSource()
                .addValue("status", (f.status() == null ? ClaimStatus.PENDING_AUDITOR : f.status()).name());
        StringBuilder where = new StringBuilder(FROM);
        if (f.dept() != null && !f.dept().isBlank()) {
            where.append(" AND d.code = :dept");
            p.addValue("dept", f.dept().trim());
        }
        if (f.category() != null) {
            where.append(" AND EXISTS (SELECT 1 FROM claim_line lc WHERE lc.claim_id = c.id AND lc.category = :category)");
            p.addValue("category", f.category().name());
        }
        if (f.min() != null) {
            where.append(" AND c.total_amount >= :min");
            p.addValue("min", f.min());
        }
        if (f.max() != null) {
            where.append(" AND c.total_amount <= :max");
            p.addValue("max", f.max());
        }
        if (f.flag() != null) {
            where.append(FLAG_EXISTS);
            p.addValue("flag", f.flag());
        }
        if (f.sample() != null) {
            where.append(" AND c.sample_audit = :sample");
            p.addValue("sample", f.sample());
        }
        if (f.ageDays() != null) {
            where.append(" AND s.activated_at <= :ageCutoff");
            p.addValue("ageCutoff", Timestamp.from(clock.instant().minus(Duration.ofDays(f.ageDays()))));
        }

        Long total = jdbc.queryForObject("SELECT count(*) " + where, p, Long.class);
        p.addValue("limit", f.size()).addValue("offset", (long) f.page() * f.size());
        var now = clock.instant();
        String sql = """
                SELECT c.id, c.claim_no, c.title, c.employee_id, e.name AS employee_name, d.code AS dept,
                       c.total_amount, c.status, c.sample_audit, c.split_suspect, c.submitted_at, c.version,
                       s.activated_at,
                       (SELECT string_agg(DISTINCT pr.flag, ',') FROM policy_result pr
                          JOIN claim_line l ON l.id = pr.claim_line_id
                         WHERE l.claim_id = c.id AND pr.evaluation_no = c.cycle_no AND pr.flag IS NOT NULL) AS flags
                """ + where + " ORDER BY " + (f.sort() == null ? QueueSort.AGE : f.sort()).orderBy
                + " LIMIT :limit OFFSET :offset";
        List<Row> rows = jdbc.query(sql, p, (rs, i) -> {
            Timestamp act = rs.getTimestamp("activated_at");
            Timestamp sub = rs.getTimestamp("submitted_at");
            String flags = rs.getString("flags");
            List<String> flagList = new java.util.ArrayList<>(flags == null ? List.of() : List.of(flags.split(",")));
            if (rs.getBoolean("split_suspect")) {
                flagList.add("SPLIT_SUSPECT");
            }
            return new Row(rs.getLong("id"), rs.getString("claim_no"), rs.getString("title"),
                    rs.getLong("employee_id"), rs.getString("employee_name"), rs.getString("dept"),
                    rs.getBigDecimal("total_amount"), rs.getString("status"), rs.getBoolean("sample_audit"),
                    rs.getBoolean("split_suspect"), flagList,
                    sub == null ? null : Ist.render(sub.toInstant()),
                    act == null ? null : Ist.render(act.toInstant()),
                    act == null ? 0 : Duration.between(act.toInstant(), now).toHours(),
                    rs.getInt("version"));
        });
        return new Result(rows, f.page(), f.size(), total == null ? 0 : total);
    }
}
