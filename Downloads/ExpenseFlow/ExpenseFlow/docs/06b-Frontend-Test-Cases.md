# ExpenseFlow — Frontend Test Cases and Persona Audit

**Owner:** P3 / P4 · **Related:** [Test Plan](06-Test-Plan.md), [Stories](04-Stories.md), [UI Design](05-UI-Design.md), [Auditor review](03-Auditor-Review.md)

This file adds the frontend test cases to the Test Plan. IDs are `TC-FE-*` and each maps to the story or risk it covers. Automated test titles start with the ID, so `vitest` and Playwright output can be traced back to this table.

## 1. How to run

| Level | Tool | Command | Needs backend? |
|---|---|---|---|
| Unit + component | Vitest, Testing Library, MSW (mocked API) | `cd frontend && npm test` · coverage: `npm run test:coverage` | No |
| E2E | Playwright (Edge `msedge`; desktop + 360 px) | `cd tests/e2e && npm ci && npx playwright test` | **Yes**: compose stack seeded at `http://localhost:5173` (`E2E_BASE_URL` to override) |

Last local run (27 Nov 2026): **146/146 unit and component tests passed**. Coverage: statements 91.6%, branches 79.3%, functions 73.8%, lines 91.6%.
The E2E suite (20 tests = 10 journeys × 2 viewports) typechecks and lists, but **has not been run**, because the backend was not available yet. Record its results in [07-Test-Result.md](07-Test-Result.md).

## 2. Unit tests (no UI)

| ID | Title | Covers |
|---|---|---|
| TC-FE-U01 | INR formatting with Indian grouping, 2 decimals | UI §1 Money |
| TC-FE-U02 | Decimal → integer paise with no float drift | CLAUDE.md coding rule 5 |
| TC-FE-U03 | Exact sums (bulk bar, batch preview) | EF-024, EF-026 |
| TC-FE-U04 | Amount validation (> 0, max 2 decimals) | EF-002, TC-CLM-03 |
| TC-FE-U05 | SLA age `2d 4h` | EF-015 |
| TC-FE-U06 | Age tone: amber > 24 h, red > 48 h | UI §1 Age |
| TC-FE-U07 | Timestamps rendered in IST | CLAUDE.md coding rule 6 |
| TC-FE-U08 | IST weekday (Sat/Sun) | EF-012 |
| TC-FE-U09 | Date helpers (add days, month label, IST instant) | EF-014 |
| TC-FE-U10 | City → tier, including aliases | S2b |
| TC-FE-U11 | Flag explanation "rule, actual, limit" | UI principle 3 |
| TC-FE-U12 | Receipt type and 5 MB limit check before upload | EF-003, R18 |
| TC-FE-A01–A02 | Bearer token on private calls, none on public calls | LLD §11 |
| TC-FE-A03 | RFC 7807 422 field errors parsed | LLD §6 |
| TC-FE-A04 | 409 → "updated by someone else" | BR-28 |
| TC-FE-A05 | 401 clears the token and returns to login | LLD §11 |
| TC-FE-A06 | Network failure → retryable error | S1 states |
| TC-FE-A07 | Expired JWT (60 min) is dropped and the reason is shown | R20 |
| TC-FE-A08 | Spring `Page`/`PagedModel`/array normalised | API contract |
| TC-FE-A09 | Empty query params dropped; all field-error shapes read | TC-SEC-15 |
| TC-FE-A10 | CSV download keeps the server file name | EF-027 |
| TC-FE-P01 | Highest role wins; every role lands on `/home` | EF-035 |
| TC-FE-P02 | Manager can act at the manager step | BR-06 |
| TC-FE-P03–P04 | Owner can never act, even as delegate or with a server hint | R2, BR-18, TC-SEC-02 |
| TC-FE-P05 | Active delegate acts on behalf of the delegator | BR-17, EF-020 |
| TC-FE-P06 | Expired, revoked or future delegation gives no rights | TC-APR-09 |
| TC-FE-P07 | A non-assignee sees "Waiting for …", not actions | R8, TC-SEC-06 |
| TC-FE-P08 | The auditor pool step can be acted on by any auditor | ADR-001 §2 |
| TC-FE-P09 | Finance head step; non-pending claims are read-only | BR-08 |
| TC-FE-P10 | The latest cycle is used after a send-back | BR-16 |
| TC-FE-P11 | Role helpers | RBAC matrix |
| TC-FE-C01 | Worst line wins | BR-12, TC-POL-20 |
| TC-FE-C02 | Live preview overrides persisted results | EF-004 |
| TC-FE-C03 | Only the latest evaluation shown after resubmit | BR-14 |
| TC-FE-C04 | SAMPLE flag on sampled claims | BR-20 |
| TC-FE-C05 | Only DRAFT and SENT_BACK are editable | BR-01, R4 |
| TC-FE-C06 | Receipt id read from every supported shape | API contract |

## 3. Component and integration tests (whole app, API mocked)

| ID | Screen | Title | Covers |
|---|---|---|---|
| TC-FE-S01 | S1 | Unauthenticated → login | LLD §11 |
| TC-FE-S02 | S1 | Users grouped into role tabs | S1 |
| TC-FE-S03 | S1 | Tabs work with arrow keys | UI §4 a11y |
| TC-FE-S04 | S1 | Sign in → JWT → role home | EF-035, TC-CLM-06 |
| TC-FE-S05 | S1 | 429 rate-limit message | TC-SEC-16 |
| TC-FE-S06 | S1 | Server unreachable → retry; empty seed → hint | S1 states |
| TC-FE-S07 | S1 | Expired-session banner | R20 |
| TC-FE-S08 | Shell | Switch user / logout | Demo script |
| TC-FE-S09–S12 | Shell | Navigation per persona (Employee, Manager, Auditor, Finance Head) | RBAC matrix |
| TC-FE-S13 | Guards | 6 role-restricted routes redirect to home | R8 |
| TC-FE-S14 | Guards | Unknown route → not found | — |
| TC-FE-S15 | Shell | 360 px bottom navigation | UI §4 |
| TC-FE-H01 | Home | Employee tasks: new, sent back, drafts, in flight | Persona: Employee |
| TC-FE-H02 | Home | Manager: inbox count + "review oldest" in one click | G3, J2 |
| TC-FE-H03 | Home | Manager sees their own active delegation | EF-020 |
| TC-FE-H04 | Home | A delegate sees the approvals section | BR-17 |
| TC-FE-H05 | Home | Auditor: queue, sample, duplicates, split suspects | Persona: Auditor |
| TC-FE-H06 | Home | Finance head: ready to pay, open batches, policy, dashboard | Persona: Finance Head |
| TC-FE-M01 | S2a | Newest first, INR, status chips, edit vs view links | EF-001 |
| TC-FE-M02 | S2a | Status filter sent to the API and kept in the URL | S2a |
| TC-FE-M03 | S2a | Empty state CTA | S2a states |
| TC-FE-M04 | S2a | Manager "My team" view (read-only) | BR-26 |
| TC-FE-M05 | S2a | 360 px cards and floating button | S2a mobile |
| TC-FE-L01 | S2b | Inline errors linked with `aria-describedby` | UI §4 |
| TC-FE-L02 | S2b | Amount ≤ 0 and future date rejected | TC-CLM-03 |
| TC-FE-L03 | S2b | Nights shown only for HOTEL and required there | TC-CLM-03 |
| TC-FE-L04 | S2b | City sets the tier | S2b |
| TC-FE-L05 | S2b | .exe and 6 MB receipts rejected before upload | TC-SEC-13 |
| TC-FE-L06 | S2b | Camera capture (rear camera) | EF-003 |
| TC-FE-L07 | S2b | Valid line saved with the selected file | EF-002 |
| TC-FE-L08 | S2b | Server field errors; existing receipt shown | LLD §6 |
| TC-FE-E01 | S2b | Create a draft → editor | TC-CLM-01 |
| TC-FE-E02 | S2b | Submit disabled with 0 lines | EF-005 |
| TC-FE-E03 | S2b | Live ✓/⚑/✕ per line with the reason | EF-004, TC-E2E-02 |
| TC-FE-E04 | S2b | A claim that will be rejected asks for confirmation; submit sends the version | S2b states, BR-28 |
| TC-FE-E05 | S2b | Add line + upload receipt | EF-002, EF-003 |
| TC-FE-E06 | S2b | Server 422 shown on the field | LLD §6 |
| TC-FE-E07 | S2b | Sent-back banner with the approver's comment | EF-019 |
| TC-FE-E08 | S2b | A non-editable claim opens read-only | R4 |
| TC-FE-E09 | S2b | 409 on submit → conflict banner | BR-28 |
| TC-FE-D01 | S3b | Claim you cannot see → "Claim not found" | BR-27, TC-SEC-08 |
| TC-FE-D02 | S3b | The owner never sees approve/reject/send back | R2, EF-021 |
| TC-FE-D03 | S3b | Receipt first; J/K changes the line and the receipt | UI principle 1 |
| TC-FE-D04 | S3b | Approve sends the version, then opens the next oldest | G3, J2 |
| TC-FE-D05 | S3b | `A` approves; inbox zero → back to the inbox | S3b keyboard |
| TC-FE-D06 | S3b | Reject needs a reason | TC-APR-06 |
| TC-FE-D07 | S3b | Send back (`S`) needs a comment | EF-019 |
| TC-FE-D08 | S3b | Double approval → 409 banner | EF-022, TC-SEC-07 |
| TC-FE-D09 | S3b | Delegate acts "on behalf of" | EF-020 |
| TC-FE-D10 | S3b | Non-approver is read-only with the reason | R8 |
| TC-FE-D11 | S3b | Steps show "approved by X on behalf of Y" | BR-17 |
| TC-FE-D12 | S3b | Duplicate → side-by-side comparison | EF-010, EF-011 |
| TC-FE-D13 | S3b | Policy-rejected → copy to a new draft | BR-03 |
| TC-FE-D14 | S3b | 360 px sticky Approve and actions sheet | S3b mobile |
| TC-FE-I01 | S3a | Oldest first, amber/red age chips | EF-015 |
| TC-FE-I02 | S3a | Enter opens the oldest claim | S3a shortcut |
| TC-FE-I03 | S3a | "Inbox zero 🎉" | S3a states |
| TC-FE-I04 | S3a | Delegated rows show on-behalf-of | EF-020 |
| TC-FE-I05 | S3a | 360 px cards | S3a mobile |
| TC-FE-G01 | S3c | Delegate list excludes yourself | BR-18 |
| TC-FE-G02 | S3c | Required fields | S3c |
| TC-FE-G03 | S3c | Loop rejected → "would create a delegation loop" | R3, TC-SEC-03 |
| TC-FE-G04 | S3c | Create delegation | EF-020 |
| TC-FE-G05 | S3c | Revoke after confirmation | S3c |
| TC-FE-Q01 | S4 | Filters sent to the API and URL; reset | EF-023 |
| TC-FE-Q02 | S4 | Bookmarked URL restores filters | Demo fallback |
| TC-FE-Q03 | S4 | SAMPLE badge; own claim not selectable | EF-025, R2 |
| TC-FE-Q04 | S4 | Bulk bar count and exact total; per-claim results | EF-024, TC-AUD-02 |
| TC-FE-Q05 | S4 | Select-all picks only selectable rows | EF-024 |
| TC-FE-Q06 | S4 | Finance head can review but not bulk approve | RBAC matrix |
| TC-FE-Q07 | S4 | 400 bad sort → error; empty → reset | TC-SEC-15 |
| TC-FE-PY01 | S5 | Batch list, status chips, empty state | S5 |
| TC-FE-PY02 | S5 | Create batch with a live preview of count, employees and total | EF-026, TC-PAY-01 |
| TC-FE-PY03 | S5 | Claim already batched → 409 | R14, TC-PAY-04 |
| TC-FE-PY04 | S5 | Rows grouped by employee with a control total | EF-027 |
| TC-FE-PY05 | S5 | Mark paid disabled until export; CSV downloads | EF-028, TC-PAY-03 |
| TC-FE-PY06 | S5 | Mark paid needs confirmation and sends the version | EF-028 |
| TC-FE-PY07 | S5 | Void needs a reason; a paid batch has no Void | EF-042, TC-PAY-06 |
| TC-FE-DB01 | S6 | KPIs: avg time, pending, oldest, duplicates | EF-030 |
| TC-FE-DB02 | S6 | Every chart has a "View as table" toggle | UI §4 |
| TC-FE-DB03 | S6 | Date range sent; missing `/kpis` → "—" | S6 |
| TC-FE-DB04 | S6 | Recent policy changes for the finance head, not the manager | R7 |
| TC-FE-AU01 | S7 | IST time, actor, on behalf of, before → after diff | EF-032, TC-AUD-04 |
| TC-FE-AU02 | S7 | Claim no / ID filter; no edit controls | EF-032 |
| TC-FE-PR01 | S8 | "Changes apply to new submissions only"; auditor read-only | S8 |
| TC-FE-PR02 | S8 | Reason required; new version posted | EF-014, TC-POL-21 |
| TC-FE-PR03 | S8 | 409 → blocked state | R7, TC-SEC-05 |
| TC-FE-PR04 | S8 | Editing disabled up front when own claims are pending | R7 |
| TC-FE-PR05 | S8 | History → roll back as version N+1 | EF-041, TC-POL-22 |

### 3a. UI shell and demo mock backend

| ID | Title | Covers |
|---|---|---|
| TC-FE-UX01 | Login: API status pill; role tabs never wrap | Login redesign |
| TC-FE-UX02 | One-click sign-in from a user card | Login redesign |
| TC-FE-UX03 | API down → "Launch with Demo Mock Data" → sign in → live inbox from mock data | Offline preview |
| TC-FE-UX04 | `?` opens the keyboard shortcuts modal anywhere | S3b keyboard |
| TC-FE-UX05 | Sidebar collapses to an icon rail and expands | App shell |
| TC-FE-UX06 | Breadcrumb shows the claim number; New claim; user menu → switch user | App shell |
| TC-FE-MK01 | Mock seed is consistent (all states, planted duplicate and split, nobody approved their own claim) | Mock backend |
| TC-FE-MK02 | Mock contract: 401, 404 IDOR, 422 validation, 400 unknown field, worst-line outcome | Mock backend |
| TC-FE-MK03 | Mock: 409 on stale version; cannot approve own claim | Mock backend |
| TC-FE-MK04 | Mock payout lifecycle; CSV trailer = header total | Mock backend |

Layout check (Edge, production build, demo data): 15 screens × 360 / 768 / 1440 / 1920 px with **0 horizontal overflow** (60 checks).

## 4. E2E (Playwright, real stack, desktop + 360 px)

| ID | File | Journey |
|---|---|---|
| TC-E2E-01 | `employee.spec.ts` | Sign in through the UI → 3-line draft → save → reopen → submit → auto-approved (or SAMPLE) |
| TC-E2E-02 | `employee.spec.ts` | Line > ₹500 without a receipt → ✕ "Receipt required" → confirm → POLICY_REJECTED → copy-to-draft offered |
| TC-E2E-03 | `approvals.spec.ts` | ₹18,000 → manager only → APPROVED |
| TC-E2E-04 | `approvals.spec.ts` | ₹60,000 → manager → auditor → APPROVED |
| TC-E2E-05 | `approvals.spec.ts` | ₹1,20,000 → manager → auditor → finance head → APPROVED |
| TC-E2E-06 | `approvals.spec.ts` | Send back with a comment → employee sees the banner, edits, resubmits → PENDING_MANAGER |
| TC-E2E-07 | `approvals.spec.ts` | Manager delegates in the UI → delegate approves → "by X on behalf of Y" (delegation revoked afterwards) |
| TC-E2E-08 | `finance.spec.ts` | Same receipt bytes from two employees → DUPLICATE → visible under the auditor DUPLICATE filter |
| TC-E2E-09 | `finance.spec.ts` | 5 claims → auditor bulk approve → payout batch → `EXPF_yyyyMMdd_id.csv` (header total = trailer) → Paid |
| TC-E2E-10 | `employee.spec.ts` | Employee A opens B's claim → "Claim not found" in the UI and 404 from the API |

Each test creates its own data through the API, with unique receipts and amounts, so it does not depend on seed randomness (Test Plan §5).

## 5. Persona workflow audit

| Persona | Task (Ideation §2) | Where | Status |
|---|---|---|---|
| All | Sign in / switch user | S1 demo login (JWT), Switch user, auto sign-out at JWT expiry with a message | ✅ |
| All | Land on their own tasks | `/home` role home with task cards per role | ✅ new |
| Employee | Capture a claim on a phone | S2b mobile bottom sheet, camera capture | ✅ |
| Employee | Attach receipts | Upload with type/size checks, SHA-256 from the server | ✅ |
| Employee | Track status, respond to send-backs | S2a filters (URL-backed), Home "Sent back to me", sent-back banner, comments | ✅ |
| Manager | Clear the inbox oldest-first | S3a + Home "Review oldest", auto-advance, shortcuts | ✅ |
| Manager | Check receipt against the line | S3b side-by-side viewer, J/K | ✅ |
| Manager | Delegate while on leave | S3c, Home delegation card | ✅ |
| Manager | See the team's claims | S2a "My team" (`mine=false`) | ✅ new |
| Auditor | Filter by flag, bulk approve clean claims, review the sample | S4 + Home shortcuts to sample, duplicates and split suspects | ✅ |
| Auditor | Audit trail, policy (read) | S7, S8 read-only | ✅ |
| Finance Head | Final approval above 1 lakh | Inbox (FH step) | ✅ |
| Finance Head | Run the payout batch | S5 create → CSV → Paid / Void | ✅ |
| Finance Head | Change policy limits, see the dashboard | S8 (blocked while own claim in flight), S6 + recent rule changes | ✅ |

## 6. Deliberately not built, and remaining gaps

| Item | Why | What is needed |
|---|---|---|
| **Self-service sign-up / password login** | Out of scope by design: Ideation §3 excludes SSO/HR integration, and §7 says the demo login picker replaces real auth (JWT still enforced). Users and the hierarchy come from the seed, and R13 forbids self-editing roles or manager. There is no sign-up endpoint. | A product decision plus backend auth endpoints, if ever wanted |
| Finance head "Reassign step" (Runbook 5.2, TC-APR-12) | No endpoint in LLD §6 | `POST /approval-steps/{id}/reassign` (backend), then a button on S3b |
| Admin-created delegation (`DELEGATION_CREATED_BY_ADMIN`) | No endpoint | `delegatorId` on `POST /delegations` for FINANCE_HEAD |
| Auditor filter "approved < 1 min" (R12, TC-SEC-10) | Not a queue parameter | `fastApproval=true` on `/auditor/queue` |
| `GET /payouts` list, `GET /dashboard/kpis` | Used by the UI but not in LLD §6 | Backend to add (see `frontend/README.md`) |
| Stopwatch timings (UI §5) | Must be measured by people | Fill in during the event |
| E2E execution | Backend not available yet | Run once the compose stack is up; paste results into 07 |
