# CLAUDE.md — ExpenseFlow

Context file for Claude Code. Read this before every task. Update it whenever a business rule changes.

ExpenseFlow is an expense-claims app built for the AI Manthan hackathon (Track A). Data is synthetic only.

---

## 1. Product summary

### Personas
| Persona | Role code | Sees | Main jobs |
|---|---|---|---|
| Employee | `EMPLOYEE` | Own claims only | Create draft claims with line items, upload receipts, submit, respond to send-backs |
| Line Manager | `MANAGER` | Own claims and claims from direct reportees | Approve, reject, send back, comment, delegate while on leave |
| Finance Auditor | `AUDITOR` | All claims | Work the review queue, bulk approve, review the 10% sample |
| Finance Head (also Admin) | `FINANCE_HEAD` | All claims | Final approval above 1,00,000 INR, payout batches, policy rule admin |

A user can hold more than one role (e.g. a manager is also an employee).

### The 7 must-have features
1. **Claims with line items.** Category, amount, date, vendor, city tier, receipt. Save as draft, then submit.
2. **Policy engine per line.** Each line gets AUTO_APPROVE, ROUTE or AUTO_REJECT (with a reason). Rules come from config.
3. **Approval chain.** Manager, then Auditor if total > 25,000 INR, then Finance Head if total > 1,00,000 INR. Approvers can comment, send back, and delegate while on leave.
4. **Auditor queue.** Filters, bulk approve, and a 10% random sample of auto-approved claims.
5. **Payouts.** Approved claims go into a batch, which exports a mock bank CSV and is then marked Paid.
6. **Dashboard.** Spend by category, department and month; policy violations; average approval time.
7. **Audit trail and access control.** The audit trail is append-only. Employees see only their own claims.

---

## 2. Stack and versions

| Layer | Choice |
|---|---|
| Frontend | React 19 + Vite, TypeScript, Tailwind, React Router, TanStack Query, Recharts |
| Backend | Spring Boot 4.1 on JDK 21 (Maven wrapper), Spring Security (JWT), Spring Data JPA, Flyway, Actuator + Micrometer, springdoc OpenAPI |
| Database | PostgreSQL 18 in Docker (JSONB for policy params) |
| Receipts | Local disk volume, SHA-256 stored per file |
| Tests | JUnit 5, AssertJ, Spring Boot Test, Testcontainers (Postgres 18), Playwright 1.60+ (msedge channel fallback), Locust (Python 3.13) |
| CI | GitHub Actions: build, tests, OWASP dependency-check, npm audit, gitleaks |
| Ops | Docker Compose (db, backend, frontend, seed, prometheus, grafana) |

Folder layout:
```
backend/      Spring Boot app (packages: claim, policy, approval, audit, payout, dashboard, user, common)
frontend/     React app
docs/         All deliverable documents
tests/e2e/    Playwright
ops/          docker-compose, prometheus, grafana
seed/         Synthetic seed data
```

---

## 3. Business rules (numbered, testable)

### 3.1 Claim states
`DRAFT, SUBMITTED, POLICY_REJECTED, PENDING_MANAGER, PENDING_AUDITOR, PENDING_FINANCE_HEAD, SENT_BACK, APPROVED, IN_PAYOUT, PAID, REJECTED`

- **BR-01** A claim is created in `DRAFT`. Only the owner can edit it, and only in `DRAFT` or `SENT_BACK`.
- **BR-02** Submitting moves the claim to `SUBMITTED` and runs the policy engine in the same transaction.
- **BR-03** If the claim outcome is AUTO_REJECT, the claim goes to `POLICY_REJECTED`. The owner can copy it to a new draft, but cannot edit it.
- **BR-04** If the claim outcome is AUTO_APPROVE **and** the total is ≤ `auto_approve_max_total` (config, default 5,000 INR), the claim goes to `APPROVED`. If it is not picked for sample audit (BR-20), it skips the chain.
- **BR-05** Every other submitted claim (outcome ROUTE, or an AUTO_APPROVE claim above the auto-approve cap) goes to `PENDING_MANAGER`.

### 3.2 Approval thresholds (INR, on the claim total)
- **BR-06** The manager step is always generated for a routed claim.
- **BR-07** The auditor step is generated if total **> 25,000.00**. Exactly 25,000.00 does not get an auditor step.
- **BR-08** The finance head step is generated if total **> 1,00,000.00**. Exactly 1,00,000.00 does not get a finance head step.
- **BR-09** Steps are generated as `approval_step` rows at submit time from the `approval_threshold` table, and they are snapshotted. Changing a threshold later does not change claims already in flight.
- **BR-10** When the last step is approved, the claim moves to `APPROVED`. A claim at or below a threshold skips the higher steps.

### 3.3 Policy rules (config only, never in code)
Rules live in the `policy_rule` table (seeded from `policy.yml`). They are versioned, and each has an `action`.

| Code | Rule | Default action |
|---|---|---|
| `MEAL_DAILY_LIMIT` | Meals ≤ 1,500 per employee per calendar day (lines on the same day are summed) | ROUTE (flag OVER_LIMIT) |
| `HOTEL_NIGHTLY_LIMIT` | Hotel ≤ 6,000 per night tier-1, ≤ 4,000 per night other (amount ÷ nights) | ROUTE (flag OVER_LIMIT) |
| `CAB_TRIP_LIMIT` | Local cab ≤ 2,000 per trip | ROUTE (flag OVER_LIMIT) |
| `RECEIPT_REQUIRED` | Receipt is mandatory when line amount > 500 (exactly 500 needs none) | AUTO_REJECT, reason `RECEIPT_REQUIRED` |
| `DUPLICATE_VENDOR_AMOUNT_DATE` | Same employee + vendor (normalised) + amount + date as an earlier line in this or any older non-draft claim | ROUTE (flag DUPLICATE) |
| `DUPLICATE_RECEIPT_HASH` | Same receipt SHA-256 as any other line, across all employees | ROUTE (flag DUPLICATE) |
| `WEEKEND_SPEND` | Expense date is a Saturday or Sunday (IST) | ROUTE (flag WEEKEND) |

- **BR-11** Each line gets one outcome: `AUTO_APPROVE`, `ROUTE` or `AUTO_REJECT(reason)`.
- **BR-12** The claim outcome is the worst line outcome, ordered AUTO_REJECT > ROUTE > AUTO_APPROVE.
- **BR-13** Changing a limit or action in `policy_rule` (as a new version) changes outcomes for later submissions without any code change or deploy.
- **BR-14** Every evaluation stores one `policy_result` row per line per rule that fired, with the rule code, rule version, outcome and reason.

### 3.4 Approver actions
- **BR-15** Actions are approve, reject (reason required), send back (comment required), and comment.
- **BR-16** Send back moves the claim to `SENT_BACK`. Resubmitting re-runs the policy engine, cancels the old steps, and generates a fresh chain from step 1.
- **BR-17** Delegation: an approver sets a delegate with from/to dates. While the delegation is active, the delegate can see and act on the delegator's pending steps. The audit row records "approved by X on behalf of Y".
- **BR-18** Nobody may approve or reject their own claim, directly or as a delegate. A user cannot be made a delegate for a step on their own claim.
- **BR-19** Delegation cycles (A→B→A, or longer) are rejected when a delegation is created. Delegation does not chain: if B is on leave, B's delegate does not inherit A's steps.

### 3.5 Sample audit
- **BR-20** When a claim auto-approves, it is picked for sample audit with probability `sample_audit_rate` (config, default 0.10). The random source is injected and seedable. A picked claim goes to `PENDING_AUDITOR` with `sample_audit = true` and shows a SAMPLE badge.

### 3.6 Payouts
- **BR-21** The finance head creates a batch from `APPROVED` claims, which move to `IN_PAYOUT`. A claim can be in only one active batch.
- **BR-22** Exporting the CSV does not change claim state. Marking the batch Paid moves every claim in it to `PAID`.
- **BR-23** Voiding a batch that is not yet paid returns its claims to `APPROVED`.

### 3.7 Audit and access
- **BR-24** `audit_event` is append-only. A DB trigger raises an error on UPDATE or DELETE.
- **BR-25** Every state change, approval action, delegation change, policy rule change and payout action writes an audit row with actor, on-behalf-of, action, before (JSONB), after (JSONB) and timestamp (IST).
- **BR-26** An employee sees only their own claims. A manager also sees direct reportees' claims plus claims delegated to them. Auditor and finance head see all.
- **BR-27** A claim the caller may not see returns **404**, not 403.
- **BR-28** The claim's `@Version` (optimistic locking) prevents double approval. A stale version returns 409.

---

## 4. Coding rules
1. **Plan first.** Show the plan and wait for approval before writing code.
2. **Tests before the policy engine.** Write `PolicyEngineTest`, run it red, then implement.
3. One feature per branch (`feature/EF-xxx-short-name`). Commit after each green test run.
4. **No secrets in git.** Use `.env` (ignored). Commit `.env.example` only.
5. Money is `BigDecimal` in Java and `NUMERIC(14,2)` in SQL. Never use double or float.
6. Dates and times are in IST (`Asia/Kolkata`). Store `timestamptz`, render in IST.
7. Business limits never appear in code; read them from `policy_rule` and `approval_threshold`.
8. Every state change goes through `ClaimStateMachine`, which writes the audit row.
9. Never trust the client: role, owner and amounts are derived server-side, and DTOs whitelist fields.
10. Sort and filter params are whitelisted (no string-built SQL).

## 5. Commands
| Task | Command |
|---|---|
| Backend build + tests | `cd backend && ./mvnw verify` |
| Frontend dev | `cd frontend && npm ci && npm run dev` |
| Frontend checks | `npm run lint && npm run typecheck && npm run build` |
| E2E | `cd tests/e2e && npx playwright test` |
| Run everything | `docker compose -f ops/docker-compose.yml up -d` |
| Reset + reseed | `docker compose -f ops/docker-compose.yml down -v && docker compose -f ops/docker-compose.yml up -d` |
| Seed only | `docker compose -f ops/docker-compose.yml run --rm seed` |

App: http://localhost:5173 · API: http://localhost:8080 · Grafana: http://localhost:3000 · Prometheus: http://localhost:9090

## 6. Definition of done
- [ ] Tests green (`./mvnw verify`, Playwright where relevant)
- [ ] Lint and typecheck clean
- [ ] Story ticked in `docs/stories.xlsx` (and `docs/04-Stories.md`)
- [ ] Every state change writes an audit row
- [ ] No secrets committed; `.env.example` updated if config was added
