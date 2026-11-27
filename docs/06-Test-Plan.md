# ExpenseFlow — Test Plan

**Owner:** P4 · **Inputs:** brief, [LLD](02-LLD.md), [Stories](04-Stories.md), [Auditor review](03-Auditor-Review.md)
The test cases below are the Markdown source for `test-cases.xlsx`.

---

## 1. Scope

**In scope:** claim CRUD and receipts; the policy engine (all rules, boundaries and config changes); approval chain thresholds, send back and delegation; auditor queue, bulk approve and sample audit; payout batch, CSV and Paid; dashboard numbers; audit immutability; access control (IDOR); the bypass cases R1–R22; deployment from one command; CI security scans; basic load.

**Out of scope:** real bank integration, SSO, OCR, browser matrix beyond Edge/Chromium, formal penetration test, accessibility audit with assistive tech (only a keyboard and contrast smoke test).

## 2. Test levels
| Level | What | Tool | Owner |
|---|---|---|---|
| Unit | Policy rules, outcome aggregation, chain factory, CSV writer, delegation cycle check | JUnit 5 + AssertJ | P1, P2 |
| API / integration | Controllers per role, state transitions, DB trigger, queries | Spring Boot Test + Testcontainers (Postgres 18) | P1, P2, P4 |
| E2E | 10 user journeys at desktop and 360 px | Playwright 1.60+ (msedge fallback) | P4 |
| Security | OWASP Top 10 review, bypass cases, dependency CVEs, secrets | Claude review + OWASP dependency-check + npm audit + gitleaks | P4, P5 |
| Performance | 50 users, 3 min | Locust | P4 |

## 3. Environments
| Env | Use |
|---|---|
| Local dev | Unit and Testcontainers |
| Compose demo (`ops/docker-compose.yml`) | E2E, load and manual exploration on seeded data |
| CI (GitHub Actions or `ci-local.ps1`) | Full automated suite on every push |

## 4. Entry and exit criteria
**Entry:** the build compiles; migrations apply; seed runs; story acceptance criteria are written.
**Exit:**
- All **Must** stories pass their linked tests
- **0 open High** defects (Med need a documented workaround)
- **100% policy rule coverage**: every rule has below, at and above tests
- 10/10 E2E pass at desktop and 360 px
- Dependency check reports no CVSS ≥ 7, gitleaks is clean
- p95 < 500 ms at 50 users

## 5. Risks
| Risk | Mitigation |
|---|---|
| Testcontainers can't pull images (network) | Pre-pull `postgres:18`; fall back to the compose DB with a test schema |
| Playwright browser download blocked | `channel: 'msedge'` |
| Flaky E2E from seeded randomness | Fixed seed; E2E creates its own claims via the API in `beforeEach` |
| Time pressure | Policy tests first (highest value); E2E written against wireframe test ids early |

## 6. Traceability
Story → test case ID (in stories.xlsx) → automated test name (`@DisplayName("TC-POL-01 …")`, Playwright `test('TC-E2E-01 …')`) → result in [Test Result](07-Test-Result.md). Bypass risk R# → TC-SEC-## (see the auditor review).

---

## 7. Test cases

Columns in xlsx: ID · Story · Type · Title · Preconditions · Steps · Test data · Expected · Priority · Automated · Result · Defect ID. Result and Defect ID start empty.

### 7.1 Policy (unit, using seeded config)
| ID | Story | Title | Test data | Expected | Pri | Auto |
|---|---|---|---|---|---|---|
| TC-POL-01 | EF-006 | Meal below limit | 1 meal 1,499.99 | AUTO_APPROVE | H | Y |
| TC-POL-02 | EF-006 | Meal at limit | 1 meal 1,500.00 | AUTO_APPROVE | H | Y |
| TC-POL-03 | EF-006 | Meal above limit | 1 meal 1,500.01 | ROUTE, OVER_LIMIT | H | Y |
| TC-POL-04 | EF-006 | Meals summed same day (incl. across claims) | 800 + 800 same date (one in an earlier submitted claim) | ROUTE, OVER_LIMIT on the 2nd | H | Y |
| TC-POL-05 | EF-007 | Hotel tier-1 at limit | 1 night 6,000.00 T1 | AUTO_APPROVE | H | Y |
| TC-POL-06 | EF-007 | Hotel tier-1 above | 1 night 6,000.01 T1 | ROUTE, OVER_LIMIT | H | Y |
| TC-POL-07 | EF-007 | Hotel other at/above | 4,000.00 / 4,000.01 OTHER | pass / OVER_LIMIT | H | Y |
| TC-POL-08 | EF-007 | Multi-night per-night amount | 3 nights 18,000 T1 / 18,000.03 T1 | pass / OVER_LIMIT | H | Y |
| TC-POL-09 | EF-008 | Cab at limit | 2,000.00 | AUTO_APPROVE | H | Y |
| TC-POL-10 | EF-008 | Cab above | 2,000.01 | ROUTE, OVER_LIMIT | H | Y |
| TC-POL-11 | EF-009 | Receipt not needed at 500 | 500.00, no receipt | AUTO_APPROVE | H | Y |
| TC-POL-12 | EF-009 | Receipt required above 500 | 500.01, no receipt | AUTO_REJECT RECEIPT_REQUIRED; claim POLICY_REJECTED | H | Y |
| TC-POL-13 | EF-011 | Duplicate receipt hash (renamed, other employee) | same bytes, different name, employee B | ROUTE, DUPLICATE | H | Y |
| TC-POL-14 | EF-010 | Duplicate vendor + amount + date (normalised vendor) | "Taj Hotel" vs " taj  hotel." same amount/date | ROUTE, DUPLICATE | H | Y |
| TC-POL-15 | EF-010 | Not a duplicate when amount differs | 4,500 vs 4,500.50 | no DUPLICATE flag | M | Y |
| TC-POL-16 | R6 | Future date rejected / stale > 90 days routed | date = tomorrow; date = today −91 | 422; ROUTE STALE_EXPENSE | M | Y |
| TC-POL-17 | R17 | Just-under-receipt pattern visible | 10 lines at 499 | all pass; shown in dashboard filter | L | N |
| TC-POL-18 | EF-012 | Weekend flag Sat/Sun (IST) | Sat 23:30 IST | ROUTE, WEEKEND | H | Y |
| TC-POL-19 | EF-012 | Weekday not flagged | Friday | no flag | M | Y |
| TC-POL-20 | EF-013 | Worst line wins | lines: approve, route, reject | claim AUTO_REJECT | H | Y |
| TC-POL-21 | EF-014 | Config change changes outcome without code | set meal limit v2 = 2,000; submit meal 1,800 | AUTO_APPROVE; audit POLICY_RULE_CHANGED | H | Y |
| TC-POL-22 | EF-041 | Rollback creates new version | roll back v3 → v2 | v4 = copy of v2; audited | M | Y |

### 7.2 Approval chain and delegation (API / integration)
| ID | Story | Title | Test data | Expected | Pri | Auto |
|---|---|---|---|---|---|---|
| TC-APR-01 | EF-015 | Inbox shows reportees only, oldest first | 3 pending for M, 1 for another manager | 3 rows sorted by age | H | Y |
| TC-APR-02 | EF-016 | Total 25,000.00 → manager only | | manager approve → APPROVED | H | Y |
| TC-APR-03 | EF-016 | Total 25,000.01 → + auditor | | manager approve → PENDING_AUDITOR | H | Y |
| TC-APR-04 | EF-017 | Total 1,00,000.00 → no finance head | | auditor approve → APPROVED | H | Y |
| TC-APR-05 | EF-017 | Total 1,00,000.01 → + finance head | | auditor approve → PENDING_FINANCE_HEAD | H | Y |
| TC-APR-06 | EF-018 | Reject needs a reason | reason "" | 422; then with reason → REJECTED | H | Y |
| TC-APR-07 | EF-019 | Send back + resubmit restarts chain | 60,000 claim at auditor → send back → edit → resubmit | old steps CANCELLED; cycle 2 starts at PENDING_MANAGER | H | Y |
| TC-APR-08 | EF-020 | Active delegation lets delegate approve | M → D today..+3 | D approves; audit on_behalf_of = M | H | Y |
| TC-APR-09 | EF-020 | Expired delegation denies | to_date = yesterday | D gets 404 / not in inbox | H | Y |
| TC-APR-10 | ADR-001 | Threshold change mid-flight ignored | claim pending; auditor threshold changed to 10,000 | existing chain unchanged | M | Y |
| TC-APR-11 | ADR-001 | Finance head's own claim goes to alternate | FH submits 1.5 L | FH step assigned to alternate | M | Y |
| TC-APR-12 | R22 | Reassign stuck step | step pending 72 h, approver on leave, no delegate | FH reassigns; audited | M | Y |

### 7.3 Auditor queue and sample audit
| ID | Story | Title | Expected | Pri | Auto |
|---|---|---|---|---|---|
| TC-AUD-01 | EF-023 | Filters (dept, category, amount, flag, sample, age) and paging; invalid sort → 400 | counts match SQL | H | Y |
| TC-AUD-02 | EF-024 | Bulk approve 5 where 1 is stale and 1 is self-owned | 3 OK, 2 failed with reasons; 3 audit rows | H | Y |
| TC-AUD-03 | EF-025 | Sample rate with seeded Random over 1,000 claims | 100 ± 20 sampled; SAMPLE badge | H | Y |
| TC-AUD-04 | EF-032 | Audit viewer filters by claim and actor | ordered events incl. on-behalf-of | M | Y |

### 7.4 Payout
| ID | Story | Title | Expected | Pri | Auto |
|---|---|---|---|---|---|
| TC-PAY-01 | EF-026 | Create batch from APPROVED | claims IN_PAYOUT; totals correct | H | Y |
| TC-PAY-02 | EF-027 | CSV golden file | byte-for-byte equal; name EXPF_20261127_12.csv; trailer = header = sum | H | Y |
| TC-PAY-03 | EF-028 | Mark Paid | all claims PAID; non-exported batch → 422 | H | Y |
| TC-PAY-04 | R14 | Claim in two batches | second create → 409 | H | Y |
| TC-PAY-05 | R19 | CSV injection | name "=HYPERLINK(..)" written as `'=HYPERLINK(..)` | M | Y |
| TC-PAY-06 | EF-042 | Void unpaid batch | claims back to APPROVED; void on PAID → 422 | M | Y |

### 7.5 Dashboard
| ID | Title | Expected | Auto |
|---|---|---|---|
| TC-DSH-01 | Spend by category vs SQL | equal to `SELECT category, SUM(amount)…` | Y |
| TC-DSH-02 | Spend by department vs SQL | equal | Y |
| TC-DSH-03 | Spend by month (12 months) vs SQL | equal; 12 buckets | Y |
| TC-DSH-04 | Violations by rule vs planted seed | ≥ planted counts | Y |
| TC-DSH-05 | Average approval time vs SQL; response < 300 ms | equal; timing OK | Y |

### 7.6 Claims
| ID | Title | Expected | Auto |
|---|---|---|---|
| TC-CLM-01 | Create draft | DRAFT, audit CLAIM_CREATED | Y |
| TC-CLM-02 | Add/edit/remove line updates total | total = Σ lines | Y |
| TC-CLM-03 | Validation (amount ≤ 0, future date, hotel nights missing) | 422 with field errors | Y |
| TC-CLM-04 | Receipt upload stores SHA-256 | hash matches the file | Y |
| TC-CLM-05 | Submit with 0 lines fails; with lines runs policy | 422 / state per outcome | Y |
| TC-CLM-06 | Demo login issues JWT with roles | token valid 60 min | Y |

### 7.7 Security and bypass
| ID | Risk | Title | Expected | Auto |
|---|---|---|---|---|
| TC-SEC-01 | R1 | Claim splitting 2 × 20,000 within 7 days | 2nd claim flagged SPLIT_SUSPECT + auditor step | Y |
| TC-SEC-02 | R2 | Self-approval via delegation | 403; no step change | Y |
| TC-SEC-03 | R3 | Delegation cycle A→B→A | 422 | Y |
| TC-SEC-04 | R4 | Edit line after approval (API) | 422; DB trigger blocks a direct update | Y |
| TC-SEC-05 | R7 | FH edits policy with own claim in flight | 409; audit logged | Y |
| TC-SEC-06 | R8 | Approve via API as a non-assignee | 403/404 | Y |
| TC-SEC-07 | R9 | Concurrent approve (2 threads) | 1 OK, 1 409; one STEP_APPROVED row | Y |
| TC-SEC-08 | R10 | IDOR claim + receipt | 404 for both | Y |
| TC-SEC-09 | R11 | Mass assignment `status`, `employeeId` | 400 unknown field; state unchanged | Y |
| TC-SEC-10 | R12 | Fast-approval outlier visible to auditor | filter "approved < 1 min" lists it | N |
| TC-SEC-11 | R13 | Employee cannot change manager/roles | no endpoint / 403 | Y |
| TC-SEC-12 | R15 | UPDATE/DELETE on audit_event | DB exception | Y |
| TC-SEC-13 | R18 | Upload .html renamed .jpg; 6 MB; `../../x.png` name | 415 / 413 / sanitised name | Y |
| TC-SEC-14 | R20 | Short JWT secret; expired token | app refuses to start; 401 | Y |
| TC-SEC-15 | — | SQL injection in sort/filter (`sort=amount;drop`) | 400 | Y |
| TC-SEC-16 | — | Login rate limit 11/min | 429 | Y |

### 7.8 E2E (Playwright, desktop + 360 px)
| ID | Title |
|---|---|
| TC-E2E-01 | Employee creates 3-line claim, saves draft, submits; small meal claim auto-approves |
| TC-E2E-02 | Line without receipt above 500 is auto-rejected with reason shown |
| TC-E2E-03 | 18,000 claim → manager only → Approved |
| TC-E2E-04 | 60,000 claim → manager → auditor → Approved |
| TC-E2E-05 | 1,20,000 claim → manager → auditor → finance head → Approved |
| TC-E2E-06 | Manager sends back; employee edits and resubmits; chain restarts |
| TC-E2E-07 | Manager on leave delegates; delegate approves; audit shows "on behalf of" |
| TC-E2E-08 | Duplicate receipt flagged; visible under the auditor DUPLICATE filter |
| TC-E2E-09 | Auditor bulk-approves 5; finance head creates payout, downloads CSV, marks Paid |
| TC-E2E-10 | Employee A opens employee B's claim URL and sees Not found |

### 7.9 Ops
| ID | Title | Expected |
|---|---|---|
| TC-OPS-01 | One-command start | seeded app usable < 3 min; seed re-run idempotent |
| TC-OPS-02 | Seed summary counts | planted counts printed and verifiable by SQL |
| TC-OPS-03 | CI gates | pipeline fails on a planted test secret / high CVE |
| TC-OPS-04 | Alert fires | backdate a step to 49 h → warning after 10 m |

### 7.10 Performance
| ID | Title | Expected |
|---|---|---|
| TC-PERF-01 | Locust 50 users, ramp 5/s, 3 min: my claims, inbox, detail, auditor queue, dashboard | p95 < 500 ms; errors < 1% |
