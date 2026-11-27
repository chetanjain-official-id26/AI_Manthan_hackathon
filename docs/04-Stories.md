# ExpenseFlow — Stories

This file is the Markdown source for `stories.xlsx`, which replaces Jira for the event. Each section below maps to one sheet. When converting, add dropdowns for Priority (Must/Should), Status (To do/In progress/Done) and Owner (P1–P5), and freeze the header row.

## Sheet 1: Epics
| Epic ID | Epic | Owner | Goal |
|---|---|---|---|
| E1 | Claims | P2 | Draft and submit claims with line items and receipts |
| E2 | Policy Engine | P1 | Per-line decisions from config |
| E3 | Approval Chain | P1 | Manager → Auditor → Finance Head, send back, delegation |
| E4 | Auditor Queue | P2 | Filters, bulk approve, 10% sample |
| E5 | Payout | P2 | Batch, CSV, Paid |
| E6 | Dashboard | P3 | Spend, violations, approval time |
| E7 | Audit & Security | P1 | Append-only trail, access control, bypass fixes |
| E8 | DevOps & SRE | P5 | One-command demo, CI, metrics, alert, runbook |

## Sheet 2: Stories

| ID | Epic | Persona | Story | Acceptance criteria (Given/When/Then) | Pri | Pts | Owner | Status | Tests |
|---|---|---|---|---|---|---|---|---|---|
| EF-001 | E1 | Employee | As an employee I want to create a draft claim so that I can add expenses over time | **G** logged in **W** I click New claim and save **T** a DRAFT claim is listed under My claims · **G** a draft **W** I reopen it **T** my lines are still there | Must | 2 | P2 | In progress (API done, UI pending) | TC-CLM-01 |
| EF-002 | E1 | Employee | As an employee I want to add, edit and remove line items (category, amount, date, vendor, city tier, nights) so that my claim is complete | **G** a draft **W** I add a line with all fields **T** it shows in the list and the total updates · **G** amount ≤ 0 or a future date **W** I save **T** I see a validation error | Must | 3 | P2 | In progress (API done, UI pending) | TC-CLM-02, TC-CLM-03 |
| EF-003 | E1 | Employee | As an employee I want to upload a receipt (PDF/JPG/PNG ≤ 5 MB, camera on phone) so that I meet policy | **G** a line **W** I upload a 2 MB JPG **T** a thumbnail shows and the SHA-256 is stored · **G** a 6 MB file or an .exe **W** I upload **T** it is rejected with a reason | Must | 3 | P2 | In progress (API done, UI pending) | TC-CLM-04, TC-SEC-13 |
| EF-004 | E1 | Employee | As an employee I want inline policy feedback per line before submitting so that I can fix issues | **G** a line > 500 with no receipt **W** I stop editing the line **T** a red "Receipt required" chip appears · **G** I attach a receipt **T** the chip clears | Must | 3 | P3 | In progress (API done, UI pending) | TC-E2E-02 |
| EF-005 | E1 | Employee | As an employee I want to submit a claim so that it gets a decision | **G** a draft with ≥ 1 line **W** I submit **T** the status changes per the policy outcome and an audit row is written · **G** a draft with 0 lines **W** I submit **T** I get an error | Must | 2 | P2 | Done | TC-CLM-05 |
| EF-006 | E2 | Finance Head | As finance I want meal spend capped at 1,500 per day (lines summed) so that meals stay in policy | **G** meals of 1,500.00 on one day **W** submitted **T** AUTO_APPROVE · **G** 1,500.01, or two lines of 800 on the same date **T** ROUTE with flag OVER_LIMIT | Must | 3 | P1 | Done | TC-POL-01..04 |
| EF-007 | E2 | Finance Head | As finance I want hotel capped at 6,000/night tier-1 and 4,000/night elsewhere so that stays are reasonable | **G** tier-1, 2 nights, 12,000 **T** pass · **G** tier-1, 2 nights, 12,000.02 **T** OVER_LIMIT · **G** other city, 1 night, 4,000.01 **T** OVER_LIMIT | Must | 3 | P1 | Done | TC-POL-05..08 |
| EF-008 | E2 | Finance Head | As finance I want local cab capped at 2,000 per trip | **G** cab 2,000.00 **T** pass · **G** cab 2,000.01 **T** OVER_LIMIT | Must | 1 | P1 | Done | TC-POL-09..10 |
| EF-009 | E2 | Finance Head | As finance I want a receipt mandatory above 500 | **G** 500.00, no receipt **T** pass · **G** 500.01, no receipt **T** AUTO_REJECT reason RECEIPT_REQUIRED, and the claim is POLICY_REJECTED | Must | 2 | P1 | Done | TC-POL-11..12 |
| EF-010 | E2 | Auditor | As an auditor I want duplicates by vendor + amount + date flagged | **G** an earlier submitted line "Taj Hotel", 4,500, 01-Nov **W** a new line with "taj hotel ", 4,500, 01-Nov **T** flag DUPLICATE with a link to the original · **G** a different amount **T** no flag | Must | 3 | P1 | Done | TC-POL-14..15 |
| EF-011 | E2 | Auditor | As an auditor I want duplicates by receipt hash flagged, even across employees | **G** the same file uploaded by employee B **W** submitted **T** flag DUPLICATE · **G** the same file renamed **T** still flagged | Must | 2 | P1 | Done | TC-POL-13 |
| EF-012 | E2 | Manager | As a manager I want weekend spend flagged so that I can question it | **G** an expense date on Sat or Sun (IST) **T** flag WEEKEND, outcome ROUTE · **G** Friday **T** no flag | Must | 1 | P1 | Done | TC-POL-18..19 |
| EF-013 | E2 | Finance Head | As finance I want claim outcome = worst line outcome | **G** lines AUTO_APPROVE + ROUTE **T** claim ROUTE · **G** any line AUTO_REJECT **T** claim POLICY_REJECTED | Must | 2 | P1 | Done | TC-POL-20 |
| EF-014 | E2 | Finance Head | As finance I want to edit policy limits as versioned config, without a deploy | **G** meal limit changed to 2,000 (v2) **W** a 1,800 meal claim is submitted **T** AUTO_APPROVE · **G** the change is saved **T** POLICY_RULE_CHANGED is audited with before/after | Must | 5 | P1 | Done | TC-POL-21, TC-SEC-05 |
| EF-015 | E3 | Manager | As a manager I want every routed claim from my reportees in my inbox, oldest first with SLA age | **G** 3 pending claims **W** I open the inbox **T** they are sorted by age with age chips · **G** a claim of a non-reportee **T** it is not shown | Must | 3 | P1 | In progress (API done, UI pending) | TC-APR-01 |
| EF-016 | E3 | Auditor | As an auditor I want claims > 25,000 routed to me after the manager | **G** total 25,000.00 approved by manager **T** APPROVED · **G** 25,000.01 **T** PENDING_AUDITOR | Must | 2 | P1 | Done | TC-APR-02..03 |
| EF-017 | E3 | Finance Head | As finance head I want claims > 1,00,000 routed to me after the auditor | **G** 1,00,000.00 approved by auditor **T** APPROVED · **G** 1,00,000.01 **T** PENDING_FINANCE_HEAD | Must | 2 | P1 | Done | TC-APR-04..05 |
| EF-018 | E3 | Approver | As an approver I want to approve, reject (reason) and comment | **G** a pending claim **W** I reject without a reason **T** validation error · **W** I approve **T** next step or APPROVED, with an audit row | Must | 3 | P1 | Done | TC-APR-06 |
| EF-019 | E3 | Approver | As an approver I want to send back for clarification so that the employee can fix it | **G** a pending claim **W** I send back with a comment **T** status SENT_BACK and the employee sees the comment · **G** the employee edits and resubmits **T** policy re-runs and the chain restarts at the manager | Must | 3 | P1 | Done | TC-APR-07, TC-E2E-06 |
| EF-020 | E3 | Manager | As a manager going on leave I want to delegate to a colleague for dates so that claims don't stall | **G** a delegation active today **W** the delegate approves **T** the audit says "approved by X on behalf of Y" · **G** an expired delegation **T** the delegate cannot see or act | Must | 5 | P1 | Done | TC-APR-08..09, TC-E2E-07 |
| EF-021 | E3 | Finance Head | As finance I want self-approval blocked, even via delegation | **G** I am the delegate of my own manager **W** I try to approve my claim **T** 403 and the button is hidden · **G** an A→B→A delegation **W** created **T** rejected | Must | 3 | P1 | Done | TC-SEC-02..03 |
| EF-022 | E3 | Approver | As an approver I want protection against double approval | **G** two tabs with the same claim **W** both approve **T** one succeeds and the other gets 409 | Should | 2 | P1 | Done | TC-SEC-07 |
| EF-023 | E4 | Auditor | As an auditor I want a filterable queue (department, category, amount range, flag, sample, age) with server paging | **G** the seeded data **W** I filter flag = DUPLICATE **T** only flagged claims show, with a count · **G** an invalid sort param **T** 400 | Must | 5 | P2 | In progress (API done, UI pending) | TC-AUD-01 |
| EF-024 | E4 | Auditor | As an auditor I want to bulk approve selected claims with confirmation | **G** 5 selected **W** I confirm **T** a per-claim result shows and 5 audit rows are written · **G** 1 of 5 is stale or self-owned **T** 4 succeed and 1 fails with a reason | Must | 3 | P2 | In progress (API done, UI pending) | TC-AUD-02, TC-E2E-09 |
| EF-025 | E4 | Auditor | As an auditor I want 10% of auto-approved claims sampled for audit | **G** a seeded Random and 1,000 auto-approvable claims **T** 100 ± 20 sampled · **G** a sampled claim **T** a SAMPLE badge shows in the queue | Must | 3 | P2 | Done | TC-AUD-03 |
| EF-026 | E5 | Finance Head | As finance head I want to create a payout batch from approved claims and preview totals | **G** 10 APPROVED claims **W** I create a batch **T** they become IN_PAYOUT and the preview shows count and total · **G** a claim already in a batch **T** 409 | Must | 3 | P2 | Done | TC-PAY-01, TC-PAY-04 |
| EF-027 | E5 | Finance Head | As finance head I want to export the batch as a mock bank CSV | **G** a batch **W** I export **T** EXPF_yyyyMMdd_id.csv downloads with header, D rows and trailer, and the totals match · **G** the golden file **T** byte-for-byte equal | Must | 3 | P2 | Done | TC-PAY-02, TC-PAY-05 |
| EF-028 | E5 | Finance Head | As finance head I want to mark a batch Paid | **G** an exported batch **W** I mark it Paid **T** all claims show PAID with an audit row · **G** a non-exported batch **T** error | Must | 2 | P2 | Done | TC-PAY-03 |
| EF-029 | E6 | Finance Head | As finance head I want spend by category, department and month | **G** the seed data **W** I open the dashboard **T** 3 charts match SQL totals | Must | 3 | P3 | In progress (API done, UI pending) | TC-DSH-01..03 |
| EF-030 | E6 | Finance Head | As finance head I want policy violations by rule and average approval time by department | **G** the seed data **T** counts match planted breaches and the average time matches SQL | Must | 3 | P3 | In progress (API done, UI pending) | TC-DSH-04..05 |
| EF-031 | E7 | Auditor | As an auditor I want an append-only audit trail for every change | **G** any state change **T** an audit row is written with actor, before/after and time · **G** a direct SQL UPDATE on audit_event **T** an error is raised | Must | 3 | P1 | Done | TC-SEC-12 |
| EF-032 | E7 | Auditor | As an auditor I want a read-only audit trail viewer filtered by claim or actor | **G** a claim id **W** I filter **T** events show in time order with on-behalf-of | Must | 2 | P3 | In progress (API done, UI pending) | TC-AUD-04 |
| EF-033 | E7 | Employee | As an employee I want only my own claims visible to me | **G** employee A **W** A requests B's claim or receipt id **T** 404 · **G** a manager **T** sees reportees only | Must | 3 | P2 | Done | TC-SEC-08, TC-E2E-10 |
| EF-034 | E7 | Finance Head | As finance I want claim-splitting detection | **G** two 20,000 claims within 7 days with overlapping dates **W** the second is submitted **T** flag SPLIT_SUSPECT and an auditor step is added | Should | 5 | P1 | Done | TC-SEC-01 |
| EF-035 | E1 | Employee | As an employee I want a demo login with a role picker | **G** the login page **W** I pick a user **T** a JWT is issued and I land on the role home | Must | 1 | P2 | In progress (API done, UI pending) | TC-CLM-06 |
| EF-036 | E8 | Team | As the team we want `docker compose up` to give a seeded demo in < 3 min | **G** a clean machine with Docker **W** compose up **T** the app is reachable with 150 employees and 3,000 claims; re-running the seed adds nothing | Must | 5 | P5 | Done | TC-OPS-01 |
| EF-037 | E8 | Team | As the team we want synthetic seed data with planted anomalies | **G** the seed has run **T** the summary prints 40 dup vendor, 15 dup hash, 60 breaches, 50 weekend, 30 > 25k, 10 > 1L | Must | 5 | P2 | Done | TC-OPS-02 |
| EF-038 | E8 | Team | As the team we want CI with tests, dependency check, npm audit and gitleaks | **G** a push **T** the pipeline runs every step and fails on CVSS ≥ 7 or a leaked secret | Must | 3 | P5 | In progress (workflow added, first GitHub run pending) | TC-OPS-03 |
| EF-039 | E8 | On-call | As on-call I want metrics and an alert on the oldest pending approval | **G** a pending step older than 48 h for 10 m **T** a warning fires, and critical at 72 h · Grafana shows queue size and p95 | Must | 3 | P5 | Done | TC-OPS-04 |
| EF-040 | E8 | On-call | As on-call I want a runbook | **G** each alert **T** the runbook has its meaning, diagnosis commands, fix and escalation | Must | 2 | P5 | To do | — |
| EF-041 | E2 | Admin | As admin I want to roll back a policy rule to an earlier version | **G** v3 active **W** I roll back to v2 **T** v4 is created as a copy of v2 and audited | Should | 2 | P1 | Done | TC-POL-22 |
| EF-042 | E5 | Finance Head | As finance head I want to void an unpaid batch | **G** an IN_PAYOUT batch **W** I void it with a reason **T** claims return to APPROVED · **G** a PAID batch **T** void is blocked | Should | 2 | P2 | Done | TC-PAY-06 |

## Sheet 3: Sprint board (build day)
| Slot | Stories | Owner |
|---|---|---|
| 09:30–10:00 | Setup, CLAUDE.md | All |
| 10:00–11:00 | Ideation, LLD, ADR, auditor review | P1, P5 |
| 10:00–11:00 | Stories, wireframes | P3, P5 |
| 11:00–12:00 | EF-035, backend skeleton, EF-031 trigger | P1 |
| 11:30–13:00 | EF-006..014 (tests first, then engine) | P1, P4 |
| 11:00–13:00 | EF-001..005, EF-033 | P2 |
| 11:00–15:30 | Frontend screens (EF-004, EF-015, EF-023, EF-029, EF-032) | P3 |
| 13:30–14:30 | EF-015..022 | P1 |
| 13:30–14:30 | EF-037 seed | P2 |
| 14:30–15:30 | EF-023..028, EF-042 | P2 |
| 14:30–15:30 | EF-029..030 API, EF-034 | P1 |
| 15:00–16:30 | EF-036, EF-038, EF-039, EF-040 | P5 |
| 11:30–16:30 | Test plan, E2E, security review | P4 |
| 16:30–17:30 | Docs, slides, demo video (no new features) | All |

## Sheet 4: Defects (filled in Phase 4)
| ID | Story | Severity | Steps | Expected | Actual | Status |
|---|---|---|---|---|---|---|
| | | | | | | |

## Sheet 5: Summary
| Epic | Stories | Points | To do | In progress | Done |
|---|---|---|---|---|---|
| E1 Claims | 6 | 14 | 0 | 5 | 1 |
| E2 Policy Engine | 10 | 24 | 0 | 0 | 10 |
| E3 Approval Chain | 8 | 23 | 0 | 1 | 7 |
| E4 Auditor Queue | 3 | 11 | 0 | 2 | 1 |
| E5 Payout | 4 | 10 | 0 | 0 | 4 |
| E6 Dashboard | 2 | 6 | 0 | 2 | 0 |
| E7 Audit & Security | 4 | 13 | 0 | 1 | 3 |
| E8 DevOps & SRE | 5 | 18 | 1 | 1 | 3 |
| **Total** | **42** | **119** | **1** | **12** | **29** |

"In progress" stories have their backend/API done and tested; they wait for the React screens (or, for EF-038, the first CI run on GitHub). EF-040 (runbook) is owned by P5.

In the .xlsx, compute the summary with `COUNTIFS`/`SUMIFS` over the Stories sheet rather than typing the numbers in.
