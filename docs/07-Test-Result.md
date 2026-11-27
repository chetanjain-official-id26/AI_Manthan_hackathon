# ExpenseFlow — Test Result

**Owner:** P4 · **Build / commit:** branch `feature/backend` (backend sections) · **Date:** 27 Nov 2026

> Backend rows below come from `./mvnw verify` (Surefire + JaCoCo, 126 tests, 0 failures) and a local gitleaks run. E2E, Locust and OWASP dependency-check have **not been run yet** and are left blank.

> **Template.** Fill it in only from real outputs: Surefire, JaCoCo, the Playwright HTML report, Locust stats, the dependency-check report, gitleaks and the defects sheet. Do not estimate or invent numbers.

---

## 1. Summary dashboard
| Level | Planned | Executed | Passed | Failed | Blocked | Pass % |
|---|---|---|---|---|---|---|
| Unit (policy, chain, CSV, security helpers) | 56 | 56 | 56 | 0 | 0 | 100% |
| API / integration (Testcontainers Postgres 18; includes TC-SEC cases) | 70 | 70 | 70 | 0 | 0 | 100% |
| E2E desktop | 10 | | | | | |
| E2E 360 px | 10 | | | | | |
| Security checks (automated TC-SEC-01..09, 11..16 inside the rows above) | 15 | 15 | 15 | 0 | 0 | 100% |
| Performance | 1 | | | | | |
| **Total (backend)** | **126** | **126** | **126** | **0** | **0** | **100%** |

Integration count includes 5 repetitions of the TC-SEC-07 concurrency test.

**Coverage (JaCoCo):** line 76.9% · branch 59.1% (excluding the one-shot `seed` job: line 90.5% · branch 73.7%) · `policy` packages line 91.4% · `policy.engine` line 95.9%

## 2. Policy rule coverage matrix
| Rule | Below | At | Above | Other | Status |
|---|---|---|---|---|---|
| MEAL_DAILY_LIMIT | TC-POL-01 | TC-POL-02 | TC-POL-03 | TC-POL-04 (sum, in claim and across claims) | Pass |
| HOTEL_NIGHTLY_LIMIT T1 | — | TC-POL-05 | TC-POL-06 | TC-POL-08 (multi-night) | Pass |
| HOTEL_NIGHTLY_LIMIT other | — | TC-POL-07 | TC-POL-07 | tier isolation | Pass |
| CAB_TRIP_LIMIT | — | TC-POL-09 | TC-POL-10 | action change (BR-13) | Pass |
| RECEIPT_REQUIRED | — | TC-POL-11 | TC-POL-12 | receipt present | Pass |
| DUPLICATE_VENDOR_AMOUNT_DATE | TC-POL-15 (no dup) | — | TC-POL-14 | in-claim duplicate | Pass |
| DUPLICATE_RECEIPT_HASH | — | — | TC-POL-13 | in-claim, across employees via API | Pass |
| WEEKEND_SPEND | TC-POL-19 | — | TC-POL-18 | days from params | Pass |
| STALE_EXPENSE (R6) | 90 days | — | 91 days (TC-POL-16) | | Pass |
| Outcome aggregation | — | — | — | TC-POL-20 | Pass |
| Config change | — | — | — | TC-POL-21, TC-POL-22 | Pass |
| Thresholds 25k / 1L | TC-APR-02, TC-APR-04 | | TC-APR-03, TC-APR-05 | | Pass |

## 3. E2E results
| ID | Desktop | 360 px | Screenshot / trace | Defect |
|---|---|---|---|---|
| TC-E2E-01 … TC-E2E-10 | | | `tests/e2e/playwright-report/` | |

## 4. Performance (Locust: 50 users, ramp 5/s, 3 min)
| Endpoint | Requests | p50 ms | p95 ms | RPS | Errors % |
|---|---|---|---|---|---|
| GET /api/claims?mine | | | | | |
| GET /api/approvals/inbox | | | | | |
| GET /api/claims/{id} | | | | | |
| GET /api/auditor/queue | | | | | |
| GET /api/dashboard/* | | | | | |
| **Aggregate** | | | | | |

## 5. Security checklist
Paste the P4.3 review table here. For each item, record the fix, or the reason it was rejected as a false alarm.

| # | Check | File:line | Severity | Real / false alarm | Fix / reason | Status |
|---|---|---|---|---|---|---|
| 1 | Broken access control / IDOR | `approval/AccessPolicy.java` | High | Control in place | 404 for claims and receipts the caller cannot see (TC-SEC-08) | Pass |
| 2 | Self-approval | `approval/ApproverAuthority.java`, `ApprovalService.load` | High | Control in place | Owner check before delegation; TC-SEC-02 | Pass |
| 3 | Mass assignment on DTOs | `claim/ClaimDtos.java`, `fail-on-unknown-properties` | High | Control in place | Unknown fields → 400 (TC-SEC-09) | Pass |
| 4 | SQL injection in filter/sort | `approval/AuditorQueueQuery.java`, `ClaimQueryService.ClaimSort` | High | Control in place | Whitelist enums + bound params (TC-SEC-15) | Pass |
| 5 | File upload (type, size, traversal, XSS name) | `claim/ReceiptStorage.java` | Med | Control in place | Magic bytes, 5 MB, UUID key, sanitised name, attachment + nosniff (TC-SEC-13) | Pass |
| 6 | JWT secret strength and expiry | `common/security/JwtService.java` | High | Control in place | < 32 bytes refuses to start; expired/tampered → 401 (TC-SEC-14) | Pass |
| 7 | CORS / CSRF | `common/security/SecurityConfig.java` | Low | Control in place | CORS = frontend origin only; stateless bearer, no cookies | Pass (review) |
| 8 | Sensitive data in logs | `RequestIdFilter`, `ProblemHandler` | Low | Not tested automatically | No tokens or bank details are logged by app code | Review |
| 9 | Login rate limit | `user/DemoLoginRateLimiter.java` | Med | Control in place | 11th login/min → 429 (TC-SEC-16) | Pass |
| 10 | Dependency CVEs (OWASP DC ≥ 7, npm audit high) | `.github/workflows/ci.yml` | — | Not run yet | Runs in CI | Pending |
| 11 | Secrets in git history (gitleaks) | `.gitleaks.toml` | — | Clean | gitleaks v8.30.1: 4 commits, no leaks | Pass |
| 12 | Audit trail immutability | `V1__schema.sql` trigger | High | Control in place | UPDATE/DELETE/TRUNCATE raise errors (TC-SEC-12) | Pass |

**Team secrets check:** gitleaks v8.30.1 run on 27 Nov 2026 on `feature/backend` history. Result: no leaks in 4 commits. The local `.env` (gitignored) is the only file with secrets: ☑ confirmed not committed.

## 6. Defect log summary
| Severity | Open | Fixed | Won't fix | Total |
|---|---|---|---|---|
| High | 0 | 0 | 0 | 0 |
| Med | 0 | 3 | 0 | 3 |
| Low | 0 | 1 | 0 | 1 |

Defects found and fixed during the backend build:
- **Med:** `addLine` returned a line with a null id (merge cascade), so `LINE_ADDED` audit rows lacked `lineId`. Fixed by flushing instead of merging; regression assertion in TC-CLM-02.
- **Med:** a line edit flushed after the claim's status changed in the same transaction was blocked by the R4 trigger. Line edits now flush immediately.
- **Med:** a second concurrent approve could get 422 (no pending step) instead of 409. The claim row is now locked for approver actions and the version is checked first; TC-SEC-07 runs 5×.
- **Low:** policy rollback without category/tier returned 404 for single-row rules. Fixed (TC-POL-22).

Details are in the Defects sheet of `stories.xlsx` and the `Defect ID` column of `test-cases.xlsx`.

## 7. Open risks
| Risk | Impact | Owner | Plan |
|---|---|---|---|
| TC-AUD-03 as written ("100 ± 20 of 1,000" for seed 42) does not hold: `java.util.Random(42)` picks 74 | Test would fail on that seed even though the selector is correct (±20 is only about ±2σ) | P4 | Test asserts 10% ± 1% over 10,000 draws plus reproducibility; update the test plan wording |
| E2E, Locust and dependency-check not yet run | Exit criteria open | P4, P5 | Run once the frontend lands / on first CI run |

## 8. Go / No-go
Exit criteria from the [Test Plan §4](06-Test-Plan.md):
- [ ] All Must stories pass
- [ ] 0 open High defects
- [ ] 100% policy rule coverage
- [ ] 10/10 E2E at both widths
- [ ] No CVSS ≥ 7, gitleaks clean
- [ ] p95 < 500 ms

**Decision:** ☐ GO ☐ NO-GO · Signed: P4 ______ P1 ______
