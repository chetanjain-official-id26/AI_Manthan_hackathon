package com.expenseflow.approval;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Prometheus gauges for the runbook alerts (EF-039):
 * expenseflow_approval_queue_size{level} and expenseflow_oldest_pending_approval_seconds{level}.
 */
@Component
public class ApprovalMetrics {

    private static final List<String> LEVELS = List.of("MANAGER", "AUDITOR", "FINANCE_HEAD");

    private final JdbcTemplate jdbc;
    private final Map<String, AtomicLong> queue = new ConcurrentHashMap<>();
    private final Map<String, AtomicLong> oldest = new ConcurrentHashMap<>();

    public ApprovalMetrics(JdbcTemplate jdbc, MeterRegistry registry) {
        this.jdbc = jdbc;
        for (String level : LEVELS) {
            queue.put(level, new AtomicLong());
            oldest.put(level, new AtomicLong());
            Gauge.builder("expenseflow.approval.queue.size", queue.get(level), AtomicLong::get)
                    .tag("level", level).description("Pending approval steps").register(registry);
            Gauge.builder("expenseflow.oldest.pending.approval.seconds", oldest.get(level), AtomicLong::get)
                    .tag("level", level).description("Age of the oldest pending step").register(registry);
        }
    }

    @Scheduled(fixedDelayString = "${expenseflow.metrics.refresh-ms:30000}", initialDelay = 5000)
    public void refresh() {
        LEVELS.forEach(l -> {
            queue.get(l).set(0);
            oldest.get(l).set(0);
        });
        jdbc.query("SELECT level, COUNT(*) AS n, COALESCE(EXTRACT(EPOCH FROM (now() - MIN(activated_at))), 0) AS age "
                + "FROM approval_step WHERE status = 'PENDING' GROUP BY level", rs -> {
            String level = rs.getString("level");
            if (queue.containsKey(level)) {
                queue.get(level).set(rs.getLong("n"));
                oldest.get(level).set(Math.max(0, (long) rs.getDouble("age")));
            }
        });
    }
}
