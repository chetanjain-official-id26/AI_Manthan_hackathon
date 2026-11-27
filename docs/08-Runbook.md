# ExpenseFlow — Runbook

**Audience:** on-call engineer · **Owner:** P5 · **Escalation:** P1 (backend/policy) → P2 (data/payout) → Finance Head (business decisions)

---

## 1. System overview
```
Browser ──▶ frontend (nginx :5173) ──/api──▶ backend (Spring Boot :8080) ──▶ postgres (:5432)
                                                  │  └─▶ receipts volume (/data/receipts)
                                                  └─/actuator/prometheus◀── prometheus (:9090) ◀── grafana (:3000)
seed (one-shot job) ──▶ postgres
```

| Component | Container | Port | Health check |
|---|---|---|---|
| Frontend | `ef-frontend` | 5173 | `curl -f http://localhost:5173` |
| Backend | `ef-backend` | 8080 | `curl -f http://localhost:8080/actuator/health` |
| Database | `ef-db` | 5432 | `docker exec ef-db pg_isready -U expenseflow` |
| Prometheus | `ef-prometheus` | 9090 | `curl -f http://localhost:9090/-/ready` |
| Grafana | `ef-grafana` | 3000 | `curl -f http://localhost:3000/api/health` |
| Seed | `ef-seed` | — | exit code 0; prints a summary |

All config comes from `.env` (template: `.env.example`).

## 2. Start, stop, reset, reseed
1. **Start:** `docker compose -f ops/docker-compose.yml up -d`
2. **Status:** `docker compose -f ops/docker-compose.yml ps`
3. **Stop (keep data):** `docker compose -f ops/docker-compose.yml stop`
4. **Down (keep volumes):** `docker compose -f ops/docker-compose.yml down`
5. **Reset (wipe everything and reseed):** `docker compose -f ops/docker-compose.yml down -v && docker compose -f ops/docker-compose.yml up -d`
6. **Reseed only (idempotent):** `docker compose -f ops/docker-compose.yml run --rm seed`
7. **Restart backend only:** `docker compose -f ops/docker-compose.yml restart backend`

## 3. Logs and metrics
- Logs: `docker compose -f ops/docker-compose.yml logs -f backend` (JSON lines; search by `requestId`)
- DB shell: `docker exec -it ef-db psql -U expenseflow -d expenseflow`
- Metrics: http://localhost:8080/actuator/prometheus
- Key metrics:
  - `expenseflow_approval_queue_size{level}`
  - `expenseflow_oldest_pending_approval_seconds{level}`
  - `expenseflow_policy_outcome_total{outcome,rule}`
  - `expenseflow_claims_submitted_total`
  - `http_server_requests_seconds_bucket`

### Grafana dashboard tour ("ExpenseFlow Ops")
| Panel | What normal looks like |
|---|---|
| Queue size by level | Manager < 50, auditor < 100, FH < 10 |
| Oldest pending age | < 24 h |
| Approval time trend | Flat or falling |
| Page p95 latency | < 500 ms |
| Policy rejects by rule | Steady mix; a sudden spike suggests a bad rule change |
| Error rate (5xx) | ≈ 0 |

## 4. Alerts

| Alert | Condition | Severity | Meaning | Likely causes |
|---|---|---|---|---|
| OldestPendingApprovalTooOld | oldest pending > 48 h for 10 m / > 72 h | warning / critical | A claim is stuck with an approver | Approver on leave with no delegate; auditor pool empty; step assigned to an inactive user |
| QueueSizeHigh | auditor queue > 100 | warning | Auditors are falling behind | Month-end spike; sample rate set too high; a rule now routes too much |
| HighLatency | p95 > 1 s for 5 m | warning | Pages are slow | Missing index, DB CPU, large unpaged query, GC pressure |
| BackendDown | `up{job="backend"} == 0` for 1 m | critical | API unreachable | Crash on startup (bad env/secret), OOM, DB unreachable |
| DbDown | backend health `db` DOWN / pg_isready fails | critical | Database unreachable | Container stopped, disk full, bad credentials |

### 4.1 OldestPendingApprovalTooOld
1. Find the stuck steps:
   ```sql
   SELECT s.claim_id, c.claim_no, s.level, s.assignee_id, e.name, now() - s.activated_at AS age
   FROM approval_step s JOIN claim c ON c.id = s.claim_id LEFT JOIN employee e ON e.id = s.assignee_id
   WHERE s.status = 'PENDING' ORDER BY s.activated_at LIMIT 20;
   ```
2. Check for an active delegation:
   ```sql
   SELECT * FROM delegation WHERE delegator_id = :assignee AND NOT revoked
     AND current_date BETWEEN from_date AND to_date;
   ```
3. Check that the assignee is active: `SELECT active FROM employee WHERE id = :assignee;`
4. **Fix:** follow procedure 5.2 (reassign). Never update `approval_step` by hand.
5. **Escalate** to the Finance Head if critical (> 72 h).

### 4.2 QueueSizeHigh
1. Break the queue down by flag:
   ```sql
   SELECT pr.flag, count(DISTINCT c.id) FROM claim c
   JOIN claim_line l ON l.claim_id = c.id JOIN policy_result pr ON pr.claim_line_id = l.id
   WHERE c.status = 'PENDING_AUDITOR' GROUP BY pr.flag;
   ```
2. Check for a recent rule change: `SELECT * FROM audit_event WHERE action = 'POLICY_RULE_CHANGED' ORDER BY created_at DESC LIMIT 5;`
3. Check the sample rate: `SELECT * FROM app_config WHERE key = 'sample_audit_rate';`
4. **Fix:** if a rule change caused the spike, roll it back (procedure 5.3). Otherwise ask auditors to bulk-approve clean claims.

### 4.3 HighLatency
1. In Grafana, find the slowest URI from `http_server_requests_seconds` by `uri`.
2. Look for slow queries:
   ```sql
   SELECT query, mean_exec_time, calls FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
   ```
   (Run `CREATE EXTENSION IF NOT EXISTS pg_stat_statements;` first if needed.)
3. Run `EXPLAIN ANALYZE` on the slow query and check that it uses the indexes listed in LLD §4.
4. Check container resources: `docker stats ef-backend ef-db`
5. **Fix:** add the missing index through a new Flyway migration, or restart the backend to recover from GC trouble. Escalate to P1.

### 4.4 BackendDown
1. `docker compose -f ops/docker-compose.yml ps backend` and `logs --tail 200 backend`
2. Common errors:
   - `JWT secret too short`: fix `JWT_SECRET` in `.env` (≥ 32 bytes).
   - `Flyway validate failed`: a migration file was edited after it ran; restore it or reset the DB in the demo.
   - `Connection refused 5432`: see 4.5.
   - `OutOfMemoryError`: raise `JAVA_OPTS=-Xmx`.
3. Restart with `docker compose -f ops/docker-compose.yml up -d backend`, then check health.

### 4.5 DbDown
1. `docker exec ef-db pg_isready -U expenseflow`
2. `docker compose -f ops/docker-compose.yml logs --tail 200 db`
3. Check disk: `docker system df` and `docker exec ef-db df -h /var/lib/postgresql/data`
4. `docker compose -f ops/docker-compose.yml up -d db`, wait for healthy, then restart the backend.
5. If the data is corrupt, restore from backup (procedure 5.7).

## 5. Procedures

### 5.1 Payout CSV generated wrongly
1. Do **not** mark the batch Paid.
2. As the Finance Head, open the batch and choose **Void** with a reason. This calls `POST /api/payouts/{id}/void`, and claims return to `APPROVED` with a `PAYOUT_BATCH_VOIDED` audit row.
3. Confirm:
   ```sql
   SELECT status, count(*) FROM claim WHERE id IN (SELECT claim_id FROM payout_item WHERE batch_id = :id) GROUP BY status;
   ```
4. Fix the cause (bank details, a bug), then create a new batch and export again.
5. If the batch is already **Paid**, it cannot be voided. Escalate to the Finance Head for a manual bank reversal, and record it as a comment on each claim.

### 5.2 Approver on leave without a delegate
1. The Finance Head opens the claim and chooses **Reassign step**, picking a new approver at the same level. The new approver must not be the claim owner.
2. Alternatively, the Finance Head creates a delegation on the absent approver's behalf (audited as `DELEGATION_CREATED_BY_ADMIN`).
3. Check that the step appears in the new approver's inbox.

### 5.3 Policy rule changed by mistake
1. Admin → Policy rules → rule → History → **Roll back to version N**. This creates version N+1 as a copy of N.
2. Find the claims submitted while the bad version was active:
   ```sql
   SELECT DISTINCT c.claim_no, c.status FROM policy_result pr
   JOIN claim_line l ON l.id = pr.claim_line_id JOIN claim c ON c.id = l.claim_id
   WHERE pr.rule_id = :bad_rule_id;
   ```
3. Approvers can send affected pending claims back; they re-evaluate on resubmit. Raise already-approved claims with the Finance Head.

### 5.4 Receipt storage full
1. `docker exec ef-backend df -h /data/receipts`
2. Uploads fail with 507/500. Logs show `No space left on device`.
3. Free space on the host, or grow the volume. Never delete receipt files of non-draft claims.
4. Optionally delete orphans (receipts with no `receipt` row) after checking with P2.

### 5.5 Rotating the JWT secret
1. Generate a new secret: `openssl rand -base64 48`
2. Update `JWT_SECRET` in `.env` (never commit it).
3. Run `docker compose -f ops/docker-compose.yml up -d backend`. Existing tokens become invalid, so users log in again.
4. If the old secret was leaked, also check gitleaks and the git history, and rotate any other secrets in the same file.

### 5.6 Backup
```bash
docker exec ef-db pg_dump -U expenseflow -Fc expenseflow > backup_$(date +%Y%m%d_%H%M).dump
tar czf receipts_$(date +%Y%m%d).tgz -C <receipts-volume-path> .
```

### 5.7 Restore
```bash
docker compose -f ops/docker-compose.yml stop backend
docker exec -i ef-db pg_restore -U expenseflow -d expenseflow --clean --if-exists < backup_YYYYMMDD_HHMM.dump
docker compose -f ops/docker-compose.yml start backend
```
Then check: `/actuator/health` is UP, and the claim count matches what you expect.

### 5.8 Changing alert thresholds
Edit `ops/prometheus/alerts.yml` (e.g. `> 48*3600`), then reload: `curl -X POST http://localhost:9090/-/reload` (requires `--web.enable-lifecycle`). Check the new values against seeded data in Grafana before the demo.
