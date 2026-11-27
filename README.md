# ExpenseFlow

ExpenseFlow is an expense-claims app with line items, a policy engine driven by config, a 3-level approval chain, an auditor queue, CSV payouts, a dashboard and an append-only audit trail.

Built for AI Manthan, Track A. **All data is synthetic.**

## Quick start (one command)
```bash
cp .env.example .env
docker compose -f ops/docker-compose.yml up -d
```
Open http://localhost:5173 and pick a demo user on the login screen.

| Service | URL |
|---|---|
| App | http://localhost:5173 |
| API + OpenAPI | http://localhost:8080/swagger-ui.html |
| Grafana | http://localhost:3000 |
| Prometheus | http://localhost:9090 |

To reset and reseed: `docker compose -f ops/docker-compose.yml down -v && docker compose -f ops/docker-compose.yml up -d`

The seed job finishes about 2–3 minutes after `up` and prints a summary: `docker logs ef-seed`.

## Demo users
All people and data are synthetic. The seed is deterministic, so these users are the same on every reset.

| Role | Example user |
|---|---|
| Employee | EMP0022 Ira Bhat |
| Manager | EMP0006 Siddharth Malhotra (active delegation to EMP0007 for 5 days) |
| Auditor | EMP0002 Arjun Desai (also the alternate approver for the finance head's own claims) |
| Finance Head | EMP0001 Kavita Menon |

## Backend
Spring Boot 4.1.3 on JDK 21, PostgreSQL 18, Flyway, JWT (HS256).

```bash
cd backend
./mvnw verify          # unit + Testcontainers integration tests (Docker required) + JaCoCo report
```

Run the API locally against your own Postgres:
```bash
export JWT_SECRET=$(openssl rand -base64 48) DB_URL=jdbc:postgresql://localhost:5432/expenseflow
./mvnw spring-boot:run -Dspring-boot.run.profiles=demo
java -jar target/expenseflow-backend.jar --spring.profiles.active=seed   # synthetic data, idempotent
```

| Area | Endpoints (base `/api`) |
|---|---|
| Auth | `GET /auth/demo-users`, `POST /auth/demo-login`, `GET /me` |
| Claims | `GET/POST /claims`, `GET/PATCH /claims/{id}`, lines CRUD, `POST …/lines/{lineId}/receipt`, `GET /receipts/{id}`, `POST …/policy-preview`, `POST …/submit`, `POST …/copy`, `POST …/comments` |
| Approvals | `POST /claims/{id}/approve`, `…/reject`, `…/send-back`, `…/steps/{stepId}/reassign`, `GET /approvals/inbox` |
| Delegation | `GET/POST /delegations`, `DELETE /delegations/{id}`, `POST /admin/delegations` |
| Auditor | `GET /auditor/queue`, `POST /auditor/bulk-approve` |
| Payouts | `GET /payouts/eligible`, `GET/POST /payouts`, `GET /payouts/{id}`, `GET /payouts/{id}/csv`, `POST …/mark-paid`, `POST …/void` |
| Dashboard | `GET /dashboard/spend-by-category`, `…/spend-by-department`, `…/spend-by-month`, `…/violations`, `…/approval-time`, `…/rule-changes` |
| Audit / admin | `GET /audit`, `GET /admin/policy-rules`, `POST /admin/policy-rules/{code}/versions`, `POST …/rollback`, `GET /admin/approval-thresholds`, `POST …/{level}/versions` |

Full OpenAPI at http://localhost:8080/swagger-ui.html. Errors are RFC 7807 `application/problem+json`.

## Frontend
React 19 + TypeScript (strict) + Vite, Tailwind 4, TanStack Query/Table, Recharts, three.js (login backdrop only, lazy-loaded).
In compose it is the `frontend` service: nginx serves the SPA on http://localhost:5173 and proxies `/api` to `backend:8080`.

```bash
cd frontend
npm ci && npm run dev          # http://localhost:5173, proxies /api to http://localhost:8080
npm run typecheck && npm run lint && npm run build
npm test                       # Vitest + Testing Library + MSW (no backend needed)
```

No backend running? On the login screen choose **Launch with Demo Mock Data**: the tab then runs on an in-memory
mock of the same API (synthetic data). Details: [frontend/README.md](frontend/README.md); test cases:
[docs/06b-Frontend-Test-Cases.md](docs/06b-Frontend-Test-Cases.md).

E2E (Playwright, needs the compose stack): `cd tests/e2e && npm ci && npx playwright test`.

## Repository layout
```
backend/     Spring Boot 4.1 (JDK 21)
frontend/    React 19 + Vite
docs/        Deliverable documents (see index below)
tests/e2e/   Playwright
ops/         Docker Compose, Prometheus, Grafana
seed/        Synthetic data generator
```

## Documents
| # | Deliverable | File |
|---|---|---|
| 1 | Ideation Document | [docs/01-Ideation.md](docs/01-Ideation.md) |
| 2 | LLD Document | [docs/02-LLD.md](docs/02-LLD.md) |
| 2a | ADR-001 Approval chains | [docs/ADR-001-approval-chains.md](docs/ADR-001-approval-chains.md) |
| 2b | Skeptical auditor review | [docs/03-Auditor-Review.md](docs/03-Auditor-Review.md) |
| 3 | Stories | [docs/04-Stories.md](docs/04-Stories.md) |
| 4 | UI Design | [docs/05-UI-Design.md](docs/05-UI-Design.md) |
| 6 | Test Plan | [docs/06-Test-Plan.md](docs/06-Test-Plan.md) |
| 7 | Test Result | [docs/07-Test-Result.md](docs/07-Test-Result.md) |
| 8 | Runbook | [docs/08-Runbook.md](docs/08-Runbook.md) |
| 9 | Demo script | [docs/09-Demo-Script.md](docs/09-Demo-Script.md) |
| 10 | Presentation outline | [docs/10-Presentation.md](docs/10-Presentation.md) |

Business rules and coding conventions: [CLAUDE.md](CLAUDE.md).
