# ExpenseFlow — Frontend

React 19 + TypeScript (strict) + Vite 7, Tailwind 4, React Router 7, TanStack Query 5 / Table 8, Recharts 3, lucide-react.

## Commands
| Task | Command |
|---|---|
| Dev server (proxies `/api` → `http://localhost:8080`) | `npm ci && npm run dev` → http://localhost:5173 |
| Type check | `npm run typecheck` |
| Lint | `npm run lint` |
| Production build | `npm run build` |
| Unit + component tests (Vitest + Testing Library + MSW, no backend needed) | `npm test` · `npm run test:coverage` |
| E2E (Playwright, needs the compose stack) | `cd ../tests/e2e && npm ci && npx playwright test` |
| Docker image (nginx on 5173, `/api` → `backend:8080`) | `docker build -t expenseflow-frontend .` |

Override the dev proxy target with `VITE_API_PROXY_TARGET=http://host:port npm run dev`.

## Layout
```
src/
  api/            client.ts (fetch + Bearer + RFC 7807 + 401 → /login), types.ts (all DTOs), one module per resource, keys.ts (query keys)
  components/ui/  Button, Field/Input/Select, Chips (status/flag/outcome), Display (Money, AgeBadge, banners, skeletons), Modal (<dialog>), Toast, DataTable
  components/layout/ AppShell (sidebar + mobile bottom nav), Guards (RequireAuth / RequireRole), NotFound
  features/       auth (S1), claims (S2a, S2b, S3b), approvals (S3a, S3c), auditor (S4), payouts (S5), dashboard (S6), audit (S7), policies (S8)
  hooks/          useDebounce, useMediaQuery, useHotkeys, useAuthedBlob, useNow
  utils/          money (INR + integer-paise math), time (IST, SLA age), cities (tier lookup), labels, misc
```

Test cases, the persona audit and remaining gaps: [docs/06b-Frontend-Test-Cases.md](../docs/06b-Frontend-Test-Cases.md).

## Demo mock mode (no backend needed)
If the API is unreachable, the login screen offers **Launch with Demo Mock Data** (also "Explore with demo data" when the API is up).
The tab then serves every `/api` call from an in-memory backend in `src/api/mock/` (lazy-loaded, about 17 kB gzipped, never in the main bundle).
It follows the same REST contract and business rules: versioned policy rules, worst line wins, threshold chain, delegation, self-approval guard, 409 on stale versions, payouts with a control-totalled CSV, and an audit trail.
It is seeded with a synthetic organisation (finance head, 2 auditors, 5 managers, 18 employees) and about 4 months of claims. Mock mode is per tab; "Exit demo mode" is in the user menu.

## Behaviour notes
- **Role home** (`/home`) is the landing page for every persona and lists their tasks (new claim / sent back; inbox with "review oldest"; audit sample and duplicates; ready to pay and open batches).
- **Session expiry**: the JWT `expiresAt` is honoured; the user is signed out when it passes and the login page explains why.
- **Token** is kept in `sessionStorage`, so each browser tab can be signed in as a different demo user (the demo script uses 4 tabs).
- **Money** is never added with floats: `utils/money.ts` parses decimal strings into integer paise.
- **Self-approval guard**: Approve/Reject/Send back render only when the user is the current step's assignee (or active delegate) **and** not the owner (`features/auth/permissions.ts`). The server stays the authority.
- **404 → "Claim not found"** for any claim or receipt the caller may not see (BR-27).
- **409** shows the conflict banner; **422** field errors are mapped from `errors` / `fieldErrors` / `invalidParams` onto inputs.
- **Shortcuts** on claim detail: `J/K` line, `A` approve, `S` send back, `R` reject, `N` next claim, `?` help. `Enter` on the inbox opens the oldest claim.
- **Auditor queue filters live in the URL**, so a pre-filtered queue can be bookmarked (demo fallback).
- Every interactive element has a `data-testid` for Playwright.

## API assumptions — please confirm with the backend (P1/P2)
The contract follows LLD §6. Field names the LLD does not fix are defined once in `src/api/types.ts`. The items below go beyond, or interpret, the contract:

| # | Item | What the UI does |
|---|---|---|
| 1 | `GET /api/payouts` (batch list) is **not in LLD §6** | S5 needs it to list batches. Returns `PayoutBatch[]` or a page. |
| 2 | `GET /api/dashboard/kpis` (optional) → `{pendingClaims, oldestPendingSeconds}` | If it returns 404, the two KPI tiles show "—". Avg approval time and duplicates caught are derived from existing endpoints. |
| 3 | `GET /api/audit?claimNo=` | When the filter is not numeric (e.g. `CLM-2026-0142`) it is sent as `claimNo`; numeric input goes as `claimId`. |
| 4 | `POST /admin/policy-rules/{ruleCode}/versions` body also carries `category`, `cityTier` | `HOTEL_NIGHTLY_LIMIT` has one row per tier, so the code alone is ambiguous. |
| 5 | `GET /me` → `activeDelegations: Delegation[]` | Used to show "acting for" and to decide delegate actions. |
| 6 | `GET /claims/{id}`: `approvalSteps[]`, `policyResults[]` (`claimLineId`, `ruleCode`, `outcome`, `flag`, `reason`, `limitAmount`, `actualAmount`, `matchClaimId`, `matchClaimNo`, `matchLineId`, `evaluationNo`), `lines[].receipt.id`, optional `allowedActions[]` | Drives line outcomes, the duplicate compare and the action bar. |
| 7 | `POST /claims/{id}/policy-preview` → `{claimOutcome, lines:[{lineId, outcome, results[]}]}` | Live ✓ / ⚑ / ✕ per line. |
| 8 | Inbox / queue rows: `activatedAt` **or** `ageSeconds`, plus `version` | Used for SLA age and optimistic locking. |
| 9 | Bulk approve result `result` is `"APPROVED"`/`"OK"`/`"SUCCESS"` (or a `PENDING_*` status) on success; anything else, or a non-null `error`, is a failure | Per-row ✓ / ✕. |
| 10 | Pages may be Spring `Page` or `PagedModel` (`{content, page:{…}}`) | Both are normalised in `client.ts`. |
| 11 | "Copy to new draft" for `POLICY_REJECTED` | Done client-side: `POST /claims` plus one `POST /lines` per line (receipts must be re-attached). |
