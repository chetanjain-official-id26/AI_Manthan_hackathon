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

## Demo users
| Role | Example user |
|---|---|
| Employee | _filled from seed summary_ |
| Manager | _filled from seed summary_ |
| Auditor | _filled from seed summary_ |
| Finance Head | _filled from seed summary_ |

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
