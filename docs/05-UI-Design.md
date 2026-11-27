# ExpenseFlow — UI Design

**Owner:** P3 · **Wireframes:** `docs/wireframes/index.html` (single file, Tailwind via CDN, sample data; to be generated)

---

## 1. Design principles
1. **Receipt next to the numbers.** Approvers never switch tabs to verify a line.
2. **Oldest first.** Queues default to SLA age, so nothing rots.
3. **Explain every decision.** Each policy flag shows the rule, the limit and the actual value ("Meal 1,800 / 1,500 per day").
4. **Phone-first capture, desktop-first review.** Employees submit on phones; auditors work dense tables.
5. **One primary action per screen.** Destructive actions (Reject, Void) are secondary and confirmed.
6. **Accessible by default.** Keyboard reachable, WCAG AA contrast, works at 360 px, and status is never shown by colour alone (chips carry text).

### Visual language
| Token | Use |
|---|---|
| Status chips | DRAFT grey · PENDING_* amber · SENT_BACK orange · APPROVED green · IN_PAYOUT blue · PAID dark green · REJECTED / POLICY_REJECTED red |
| Flag chips | OVER_LIMIT, DUPLICATE, WEEKEND, RECEIPT, SAMPLE, SPLIT_SUSPECT (icon + text) |
| Money | Right-aligned, Indian grouping `₹1,20,000.00`, tabular numerals |
| Age | `2d 4h`; amber > 24 h, red > 48 h |

---

## 2. Screen inventory
| # | Screen | Persona | Route |
|---|---|---|---|
| S1 | Demo login with role picker | All | `/login` |
| S2a | My claims | Employee | `/claims` |
| S2b | New / edit claim | Employee | `/claims/new`, `/claims/:id/edit` |
| S3a | Approver inbox | Manager, Auditor, FH | `/inbox` |
| S3b | Claim detail + receipt viewer | Approvers | `/claims/:id` |
| S3c | Delegation settings | Approvers | `/settings/delegation` |
| S4 | Auditor queue | Auditor | `/auditor` |
| S5 | Payout batches | Finance Head | `/payouts`, `/payouts/:id` |
| S6 | Dashboard | FH, Auditor, Manager | `/dashboard` |
| S7 | Audit trail viewer | Auditor, FH | `/audit` |
| S8 | Policy rules editor | FH (Admin) | `/admin/policies` |

---

## 3. Screens

### S1 — Demo login
- **Purpose:** Pick a seeded user quickly in the demo.
- **Layout:** A centred card with four role tabs (Employee / Manager / Auditor / Finance Head). Each tab lists 5 users (name, department), with search. A "Sign in as" button.
- **States:** loading skeleton list · error "Cannot reach server, retry" · empty "Run the seed job".
- **A11y:** tabs use arrow keys; Enter signs in.

### S2a — My claims
- **Columns:** Claim no · Title · Submitted · Lines · Total · Status chip · Last action.
- **Default sort:** last updated, newest first. Filter chips by status.
- **Mobile:** cards (title, total, status chip, date) with a floating "+ New claim" button.
- **States:** empty "No claims yet. Create your first claim" with a CTA · loading skeleton rows · error banner with retry · no-permission (n/a).

### S2b — New / edit claim (mobile-first)
```
┌──────────── 360px ─────────────┐
│ ← New claim            Draft   │
│ Title [Client visit Pune     ] │
│ ┌ Line 1 ───────────── ✓ ────┐ │
│ │ Meal · 1,200 · 10 Nov      │ │
│ │ Hotel Sagar · receipt ✓    │ │
│ └────────────────────────────┘ │
│ ┌ Line 2 ───────────── ⚑ ────┐ │
│ │ Hotel · 9,000 · 2 nights   │ │
│ │ Tier-1 · ⚑ OVER_LIMIT      │ │
│ │ 4,500/night ≤ 6,000 ✓      │ │  (inline feedback)
│ └────────────────────────────┘ │
│ ┌ Line 3 ───────────── ✕ ────┐ │
│ │ Cab · 650 · 11 Nov         │ │
│ │ ✕ Receipt required (>500)  │ │
│ │ [📷 Add receipt]           │ │
│ └────────────────────────────┘ │
│ [+ Add line]                   │
│ Total ₹10,850.00               │
│ [Save draft]   [Submit ▶]      │
└────────────────────────────────┘
```
- **Line form (bottom sheet on mobile, side panel on desktop):** Category select · Amount (numeric keypad) · Date (default today; no future dates) · Vendor · City (autocomplete sets the tier) · Nights (hotel only) · Description · Receipt (camera / file picker, preview, 5 MB limit).
- **Inline policy:** calls `/policy-preview` 500 ms after the user stops editing a line. Each line shows ✓ / ⚑ (route) / ✕ (reject) with a one-line reason.
- **Desktop variant:** a lines table on the left (Category, Date, Vendor, Amount, Receipt, Policy) and the line editor plus receipt preview on the right.
- **States:** saving indicator · submit disabled with 0 lines · submit confirmation summarising outcomes ("1 line will be rejected, so the claim will be rejected. Continue?") · read-only when the claim is not DRAFT or SENT_BACK · SENT_BACK shows the approver's comment banner at the top.

### S3a — Approver inbox
- **Columns:** Age (SLA) · Claim no · Employee · Department · Total · Flags · Step (Manager/Auditor/FH) · On behalf of.
- **Default sort:** age descending (oldest first).
- **Mobile:** cards with an age badge, name, total and flag icons. Tap to open.
- **States:** empty "Inbox zero 🎉" · loading · error · no-permission (an employee-only user is redirected to My claims).
- **Shortcut:** `Enter` opens the top claim.

### S3b — Claim detail with receipt viewer (core approver flow)
```
Desktop ≥1024px
┌──────────────────────────┬───────────────────────────────┐
│  RECEIPT VIEWER          │ CLM-2026-0142 · Ananya Rao    │
│  [image/pdf, zoom, rot]  │ Sales · ₹18,450 · age 2d 3h   │
│                          │ Lines                         │
│                          │ ▸1 Meal 1,200  10 Nov ✓       │
│                          │ ▸2 Hotel 9,000 ⚑OVER_LIMIT    │◀ selecting a line
│  ◀ 2/3 ▶ receipts        │ ▸3 Cab 650 Sat ⚑WEEKEND       │  switches receipt
│                          │ Policy reasons · Steps · Trail│
│                          │ Comment [________________]    │
│                          │ [Approve ✓] [Send back] [Reject]
└──────────────────────────┴───────────────────────────────┘
```
- **Mobile:** receipt at the top (tap for full screen), lines below, and a sticky action bar at the bottom (Approve primary; "⋯" holds Send back / Reject / Comment).
- **Keyboard:** `J/K` next/previous line · `A` approve · `S` send back · `R` reject · `N` next claim after an action.
- **After approve:** a toast "Approved · opening next" and the next oldest claim loads automatically.
- **States:** receipt missing placeholder · receipt load error with a download link · claim not visible renders the 404 page "Claim not found" · not the current approver shows read-only with the reason ("Waiting for auditor").
- **Duplicate flag:** a link "Matches CLM-2026-0088 line 2" opens a side-by-side comparison.

### S3c — Delegation settings
- **Form:** Delegate (searchable; self excluded) · From · To · Reason. A list of active and past delegations with Revoke.
- **Validation:** shows server errors such as "Would create a delegation loop" and "Dates overlap an existing delegation".

### S4 — Auditor queue (dense)
- **Filters bar:** Department · Category · Amount min/max · Flag (DUPLICATE / WEEKEND / OVER_LIMIT / SPLIT_SUSPECT) · Sample only · Age > N days · Reset.
- **Columns:** ☐ · Age · Claim no · Employee · Dept · Lines · Total · Flags · SAMPLE badge · Manager approved by.
- **Default sort:** age descending; server-side paging of 50.
- **Bulk:** a selection bar shows "5 selected · ₹1,42,300". Bulk approve opens a confirmation modal listing the claims, then shows per-claim results (✓ / ✕ reason).
- **States:** empty "No claims match these filters" · loading skeleton · error · no-permission → 404 page.

### S5 — Payout batches
- **List columns:** Batch no · Created · Claims · Employees · Total · Status (DRAFT/EXPORTED/PAID/VOID) · Actions.
- **Create:** a table of APPROVED claims (☐, claim, employee, total) → preview card (count, employees, total) → Create batch.
- **Detail:** totals card · rows grouped by employee · Export CSV · Mark Paid (enabled after export, with a confirmation) · Void (with a reason; hidden once paid).
- **States:** empty "No approved claims to pay".

### S6 — Dashboard
Four charts in a 2×2 grid on desktop, stacked on mobile: Spend by category (bar), Spend by department (horizontal bar), Spend by month (line, 12 months), and Violations by rule (bar). Plus a KPI tile row: Average approval time · Pending claims · Oldest pending · Duplicates caught. A date range filter. Each chart has a "view as table" toggle for accessibility.

### S7 — Audit trail viewer
- **Columns:** Time (IST) · Actor · On behalf of · Entity · Action · Before → After (expandable diff).
- **Filters:** claim no, actor, date range. **Sort:** time descending. Read-only, with no edit controls.

### S8 — Policy rules editor
- A table of active rules (code, category, tier, limit, unit, action, version, effective from). An "Edit" opens a form for a new version (limit, action, effective from, **reason required**).
- A history drawer per rule, with "Roll back to this version".
- A banner explains: "Changes apply to new submissions only."
- Blocked state: "You have a claim in flight, so rules cannot be edited until it is decided."

---

## 4. Accessibility checklist (all screens)
- [ ] Every action reachable by Tab, with a visible focus ring
- [ ] Contrast ≥ 4.5:1 for text and ≥ 3:1 for chips and icons
- [ ] Status and flags carry text, not colour only
- [ ] Usable at 360 px with no horizontal scroll (tables become cards)
- [ ] Form fields have labels; errors are linked via `aria-describedby`
- [ ] Charts have a table alternative
- [ ] `data-testid` on every interactive element used by Playwright

---

## 5. Stopwatch test — approver flow
**Task:** "Open the oldest claim, check the receipt, approve." **Target:** < 30 s per claim.

| Tester | Wireframe (s) | Built app (s) | Notes |
|---|---|---|---|
| Person 1 | | | |
| Person 2 | | | |
| Person 3 | | | |
| **Average** | | | |

_Fill in with real stopwatch timings during the event._

### Changes made after timing
| # | Observation | Change |
|---|---|---|
| 1 | _e.g. testers scrolled to find the receipt_ | _e.g. receipt pinned on the left at load_ |
| 2 | | |
| 3 | | |
