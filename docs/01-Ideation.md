# ExpenseFlow — Ideation Document

**Event:** AI Manthan, Track A · **Date:** 27 Nov 2026 · **Owners:** P1 (Tech lead), P5 (BA)

---

## 1. Problem statement

Today, expense claims run on email and Excel. An employee fills a spreadsheet, attaches photos of receipts, and emails it to their manager. Finance then re-keys it to pay.

| Pain today | Effect |
|---|---|
| Policy limits are checked by eye | Breaches are missed (e.g. hotel above the city cap), or caught only after payment |
| Duplicate claims are not detected | The same receipt or bill gets paid twice, sometimes by two employees |
| Approvals sit in inboxes | Claims take days to weeks; there is no visibility into where they are stuck |
| No reliable trail | Hard to prove who approved what, and when, at audit time |
| Payout is manual | Finance re-types amounts into a bank file, so typos happen |

### Goals (measurable)
| # | Goal | Target |
|---|---|---|
| G1 | Every line item gets a policy decision automatically at submit | 100% of lines; decision under 1 s |
| G2 | Planted duplicates and limit breaches in the seed data are caught | ≥ 95% of planted cases detected |
| G3 | Approvers clear a claim quickly | "Open oldest, check receipt, approve" in < 30 s per claim (stopwatch test) |

---

## 2. Personas

| Persona | Goals | Pains | Top 3 tasks |
|---|---|---|---|
| **Employee** (e.g. a sales executive who travels weekly) | Get reimbursed fast, with no back-and-forth | Doesn't know the limits until rejected; loses receipts; can't see status | 1. Capture a claim on phone 2. Attach receipts 3. Track status and respond to send-backs |
| **Line Manager** | Approve genuine spend quickly; not be blamed for breaches | Long email threads; can't see receipts next to amounts; leave causes backlogs | 1. Clear inbox oldest-first 2. Check receipt vs line 3. Delegate while on leave |
| **Finance Auditor** | Catch fraud and errors before payment | Reviews everything manually; no risk-based view | 1. Filter the queue by flag 2. Bulk approve clean claims 3. Review the random sample |
| **Finance Head (Admin)** | Control spend; pay accurately and on time; own the policy | Has no dashboard; payout file built by hand; policy changes need IT | 1. Final approval above 1 lakh 2. Run the payout batch 3. Adjust policy limits and view the dashboard |

---

## 3. Proposed solution

1. **Claims with line items.** Each line holds a category (meal, hotel, cab, other), amount, date, vendor, city tier, nights for hotels, and a receipt (photo or PDF). Claims save as drafts and can be submitted from a phone.
2. **Policy engine.** On submit, every line is checked against rules held in a config table: daily meal cap, nightly hotel cap by city tier, per-trip cab cap, receipt above 500, duplicates (vendor + amount + date, or the same receipt hash) and weekend spend. Each line is marked auto-approve, route for approval, or auto-reject with a reason, and the claim takes the worst line's outcome. Finance can change a limit with no deploy.
3. **Approval chain.** Routed claims go to the line manager. Claims above 25,000 INR also go to an auditor, and claims above 1,00,000 INR also go to the finance head. Approvers can approve, reject, send back with a comment, or comment. A manager on leave delegates to a colleague, and the trail shows "on behalf of".
4. **Auditor queue.** A dense table filtered by department, category, amount, flag type and age, with multi-select bulk approve. Ten percent of auto-approved claims are randomly pulled into the queue with a SAMPLE badge.
5. **Payouts.** The finance head bundles approved claims into a batch, previews totals, downloads a mock bank CSV (header, one row per employee, control-total trailer) and marks the batch Paid.
6. **Dashboard.** Spend by category, department and month; policy violations by rule; average approval time by department.
7. **Audit trail and access.** Every change is written to an append-only table that the database itself protects. Employees see only their own claims, and other IDs return "not found".

### Out of scope
SSO and HR integration, real bank integration, OCR of receipts, multi-currency, mileage and per-diem calculation, mobile native apps, email and push notifications (shown in-app only), and corporate cards.

---

## 4. User journeys

**J1. Employee submits a 3-line claim (phone)**
Login → New claim → adds a dinner of 1,200 with a receipt, a cab of 650 with a receipt, and a parking charge of 700 with no receipt → inline feedback shows the third line will be rejected (RECEIPT_REQUIRED) → attaches the receipt → feedback turns green → Submit → the claim shows `PENDING_MANAGER` (or `APPROVED` if small and clean).

**J2. Manager approves on phone**
Inbox, sorted oldest first with SLA age → taps the oldest claim → sees the receipt first, then line items with a WEEKEND flag → reads the employee's note → Approve → the next claim opens.

**J3. Auditor bulk-approves**
Queue → filter "Flag = none, Amount 25k–1L" → reviews 5 rows → selects all → Bulk approve → a confirmation lists the count and total → per-row results show 5 approved. Then filter "Sample only" → opens a SAMPLE claim → approves.

**J4. Finance head runs payout**
Payouts → New batch → picks all APPROVED claims → previews 42 claims, 31 employees and the total → Export CSV (EXPF_20261127_12.csv) → uploads it to the bank (mock) → Mark Paid → claims show `PAID`.

---

## 5. How we use AI (Claude) in each phase

| Phase | Claude usage |
|---|---|
| 0 Setup | Claude Project with the brief and plan as knowledge; Claude Code writes CLAUDE.md, the repo skeleton and .gitignore |
| 1 Architecture | Drafts the ideation doc, C4 diagrams, state machine, ERD and ADR-001; acts as a **skeptical finance auditor** to find bypass risks |
| 2 UI and stories | Writes stories with Given/When/Then; proposes layouts and builds clickable HTML wireframes |
| 3 Development | Claude Code works plan-first per feature branch; policy tests are written before the engine; seed data generator |
| 4 Testing | Writes the test plan and test cases, Playwright E2E and a Locust file; OWASP security review of the code |
| 5–6 SRE | Docker Compose, CI workflow, Micrometer metrics, Grafana dashboard, alert rules, runbook |
| 7 Wrap-up | Demo script and slides, built from real test output we paste in (never invented numbers) |

---

## 6. Success metrics for the demo
- A policy decision with a reason is shown on every line, live.
- A planted duplicate receipt is caught and appears under the auditor's DUPLICATE filter.
- Threshold routing is correct at 18,000 (manager only), 60,000 (+ auditor) and 1,20,000 (+ finance head).
- The trail shows "approved by X on behalf of Y".
- Changing the meal limit in config changes an outcome without a redeploy.
- Approver stopwatch time is < 30 s per claim.
- Grafana shows the oldest pending approval, with an alert firing.
- Everything starts from one command, with seeded data in < 3 min.

---

## 7. Risks and assumptions

| Type | Item | Mitigation |
|---|---|---|
| Risk | Scope too large for one day | 7 workstreams, feature freeze at 17:30, last hour for docs only |
| Risk | Approval bypass (self-approval, claim splitting, IDOR) | Skeptical auditor review in Phase 1; tests for every bypass |
| Risk | Live demo fails | Backup video recorded before the freeze; one-command reset |
| Risk | Browser download blocked for Playwright | Use the installed Edge (`msedge` channel) |
| Assumption | Single currency (INR); IST timezone | Documented in CLAUDE.md |
| Assumption | City tier is chosen by the employee per line and validated against a city list | Auditor can see the city on the line |
| Assumption | Clean claims ≤ 5,000 INR may auto-approve without a manager (config) | Covered by the 10% sample audit |
| Assumption | Demo login picker replaces real auth | JWT still enforced on every API call |
