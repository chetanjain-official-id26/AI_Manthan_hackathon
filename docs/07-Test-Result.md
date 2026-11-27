# ExpenseFlow — Test Result

**Owner:** P4 · **Build / commit:** `_____` · **Date:** 27 Nov 2026

> **Template.** Fill it in only from real outputs: Surefire, JaCoCo, the Playwright HTML report, Locust stats, the dependency-check report, gitleaks and the defects sheet. Do not estimate or invent numbers.

---

## 1. Summary dashboard
| Level | Planned | Executed | Passed | Failed | Blocked | Pass % |
|---|---|---|---|---|---|---|
| Unit (policy, chain, CSV) | | | | | | |
| API / integration | | | | | | |
| E2E desktop | 10 | | | | | |
| E2E 360 px | 10 | | | | | |
| Security checks | | | | | | |
| Performance | 1 | | | | | |
| **Total** | | | | | | |

**Coverage (JaCoCo):** line ___% · branch ___% · `policy` package ___%

## 2. Policy rule coverage matrix
| Rule | Below | At | Above | Other | Status |
|---|---|---|---|---|---|
| MEAL_DAILY_LIMIT | TC-POL-01 | TC-POL-02 | TC-POL-03 | TC-POL-04 (sum) | |
| HOTEL_NIGHTLY_LIMIT T1 | — | TC-POL-05 | TC-POL-06 | TC-POL-08 (multi-night) | |
| HOTEL_NIGHTLY_LIMIT other | — | TC-POL-07 | TC-POL-07 | | |
| CAB_TRIP_LIMIT | — | TC-POL-09 | TC-POL-10 | | |
| RECEIPT_REQUIRED | — | TC-POL-11 | TC-POL-12 | | |
| DUPLICATE_VENDOR_AMOUNT_DATE | TC-POL-15 (no dup) | — | TC-POL-14 | | |
| DUPLICATE_RECEIPT_HASH | — | — | TC-POL-13 | | |
| WEEKEND_SPEND | TC-POL-19 | — | TC-POL-18 | | |
| Outcome aggregation | — | — | — | TC-POL-20 | |
| Config change | — | — | — | TC-POL-21, TC-POL-22 | |
| Thresholds 25k / 1L | TC-APR-02, TC-APR-04 | | TC-APR-03, TC-APR-05 | | |

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
| 1 | Broken access control / IDOR | | | | | |
| 2 | Self-approval | | | | | |
| 3 | Mass assignment on DTOs | | | | | |
| 4 | SQL injection in filter/sort | | | | | |
| 5 | File upload (type, size, traversal, XSS name) | | | | | |
| 6 | JWT secret strength and expiry | | | | | |
| 7 | CORS / CSRF | | | | | |
| 8 | Sensitive data in logs | | | | | |
| 9 | Login rate limit | | | | | |
| 10 | Dependency CVEs (OWASP DC ≥ 7, npm audit high) | | | | | |
| 11 | Secrets in git history (gitleaks) | | | | | |
| 12 | Audit trail immutability | | | | | |

**Team secrets check:** gitleaks run on ______ by ______. Result: ______. No `.env`, JWT secret or password committed: ☐ confirmed.

## 6. Defect log summary
| Severity | Open | Fixed | Won't fix | Total |
|---|---|---|---|---|
| High | | | | |
| Med | | | | |
| Low | | | | |

Details are in the Defects sheet of `stories.xlsx` and the `Defect ID` column of `test-cases.xlsx`.

## 7. Open risks
| Risk | Impact | Owner | Plan |
|---|---|---|---|
| | | | |

## 8. Go / No-go
Exit criteria from the [Test Plan §4](06-Test-Plan.md):
- [ ] All Must stories pass
- [ ] 0 open High defects
- [ ] 100% policy rule coverage
- [ ] 10/10 E2E at both widths
- [ ] No CVSS ≥ 7, gitleaks clean
- [ ] p95 < 500 ms

**Decision:** ☐ GO ☐ NO-GO · Signed: P4 ______ P1 ______
