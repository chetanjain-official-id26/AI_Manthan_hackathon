package com.expenseflow.seed;

import com.expenseflow.support.IntegrationTest;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.nio.file.Files;
import java.sql.DriverManager;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * EF-036 / EF-037 / TC-OPS-01..02: the seed job on its own database. A smaller run (400 claims) uses the
 * same code path as the 3,000-claim demo seed; it runs at context start like the real one-shot job.
 */
@SpringBootTest(properties = {
        "expenseflow.jwt.secret=test-secret-that-is-definitely-longer-than-32-bytes",
        "expenseflow.seed.claims=400",
        "expenseflow.seed.exit-when-done=false",
        "expenseflow.sample-audit.seed=42",
        "expenseflow.metrics.refresh-ms=600000"
})
@ActiveProfiles("seed")
class SeedRunnerIT {

    static final String DB = "seedtest";

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) throws Exception {
        var pg = IntegrationTest.POSTGRES;
        try (var c = DriverManager.getConnection(pg.getJdbcUrl(), pg.getUsername(), pg.getPassword());
             var st = c.createStatement()) {
            var rs = st.executeQuery("SELECT 1 FROM pg_database WHERE datname = '" + DB + "'");
            if (!rs.next()) {
                st.execute("CREATE DATABASE " + DB);
            }
        }
        r.add("spring.datasource.url", () -> pg.getJdbcUrl().replace("/" + pg.getDatabaseName(), "/" + DB));
        r.add("spring.datasource.username", pg::getUsername);
        r.add("spring.datasource.password", pg::getPassword);
        r.add("expenseflow.receipts.dir", () -> {
            try {
                return Files.createTempDirectory("ef-seed-receipts").toString();
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        });
    }

    @Autowired
    SeedRunner runner;
    @Autowired
    JdbcTemplate jdbc;

    private long count(String sql) {
        Long n = jdbc.queryForObject(sql, Long.class);
        return n == null ? 0 : n;
    }

    @Test
    @DisplayName("TC-OPS-02 seed creates people, claims through every state, planted anomalies, payouts; re-run adds nothing")
    void seedsAndIsIdempotent() {
        assertThat(count("SELECT count(*) FROM app_config WHERE config_key = 'seed_completed'")).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM employee")).isEqualTo(150);
        assertThat(count("SELECT count(*) FROM claim")).isEqualTo(400);
        assertThat(count("SELECT count(*) FROM employee WHERE roles LIKE '%FINANCE_HEAD%'")).isEqualTo(1);
        assertThat(count("SELECT count(*) FROM employee WHERE roles LIKE '%AUDITOR%'")).isEqualTo(4);
        assertThat(count("SELECT count(*) FROM employee WHERE roles LIKE '%MANAGER%'")).isEqualTo(16);

        List<String> statuses = jdbc.queryForList("SELECT DISTINCT status FROM claim", String.class);
        assertThat(statuses).contains("PAID", "APPROVED", "POLICY_REJECTED");
        assertThat(statuses).anyMatch(s -> s.startsWith("PENDING_"));

        // planted anomalies are detected by the real engine
        assertThat(count("SELECT count(*) FROM policy_result WHERE rule_code = 'WEEKEND_SPEND'")).isPositive();
        assertThat(count("SELECT count(*) FROM policy_result WHERE flag = 'OVER_LIMIT'")).isPositive();
        assertThat(count("SELECT count(*) FROM policy_result WHERE rule_code = 'RECEIPT_REQUIRED'")).isPositive();
        assertThat(count("SELECT count(*) FROM policy_result WHERE flag = 'DUPLICATE'")).isPositive();
        assertThat(count("SELECT count(*) FROM claim WHERE total_amount > 100000")).isPositive();
        assertThat(count("SELECT count(*) FROM claim WHERE sample_audit")).isPositive();

        // payouts, delegation history and the audit trail
        assertThat(count("SELECT count(*) FROM payout_batch WHERE status = 'PAID'")).isPositive();
        assertThat(count("SELECT count(*) FROM delegation")).isEqualTo(2);
        assertThat(count("SELECT count(*) FROM audit_event WHERE action = 'CLAIM_SUBMITTED'")).isGreaterThanOrEqualTo(400);
        assertThat(count("SELECT count(*) FROM audit_event WHERE action = 'STEP_SENT_BACK'")).isPositive();

        // idempotent re-run (TC-OPS-01)
        long auditBefore = count("SELECT count(*) FROM audit_event");
        assertThat(runner.execute()).isZero();
        assertThat(count("SELECT count(*) FROM claim")).isEqualTo(400);
        assertThat(count("SELECT count(*) FROM audit_event")).isEqualTo(auditBefore);

        // data without the completion marker is treated as a broken run and refused
        jdbc.update("UPDATE app_config SET config_key = 'seed_completed_hidden' WHERE config_key = 'seed_completed'");
        try {
            assertThat(runner.execute()).isEqualTo(1);
            assertThat(count("SELECT count(*) FROM claim")).isEqualTo(400);
        } finally {
            jdbc.update("UPDATE app_config SET config_key = 'seed_completed' WHERE config_key = 'seed_completed_hidden'");
        }
    }
}
