# ExpenseFlow — Presentation Outline (10–12 slides)

Source outline for the PPTX deck. Every number marked `[REAL]` must come from the Test Result or the seed summary. Never estimate.

| # | Slide | Content | Visual |
|---|---|---|---|
| 1 | **ExpenseFlow** | Tagline: "Policy-checked, audit-proof expense claims in minutes, not weeks." Team names and roles (P1–P5) | Logo + team |
| 2 | Problem & impact | Email + Excel; missed breaches; duplicate payments; slow approvals. 3 goals (G1–G3) | 3 pain icons → 3 goals |
| 3 | Personas & journeys | Employee, Manager, Auditor, Finance Head; one line per journey | 4 persona cards |
| 4 | Solution overview | The 7 must-have features | Feature grid |
| 5 | Architecture | C4 container: React → Spring Boot → Postgres; Prometheus/Grafana; one-command compose | Container diagram (LLD §1.2) |
| 6 | State machine + policy as config | Claim lifecycle; thresholds 25k / 1L; policy_rule table, versioned; worst line wins | State diagram + rule table |
| 7 | Security: bypasses found and fixed | Top 5 from the auditor review: splitting, self-approval via delegation, edit after approval, IDOR, policy self-change. 14 High risks addressed `[REAL: fixed count]` | Risk → fix table |
| 8 | UI highlights + stopwatch | Side-by-side receipt viewer; mobile capture; stopwatch result `[REAL: avg s]` vs 30 s target | 2 screenshots + timing bar |
| 9 | Testing results | Policy rule coverage 100% `[REAL]`; E2E `[REAL]/10`; unit/API pass `[REAL]`; defects by severity `[REAL]`; security checklist `[REAL]`; p95 `[REAL]` ms | KPI tiles |
| 10 | DevOps + SRE | One command < 3 min `[REAL]`; CI gates (tests, OWASP DC, npm audit, gitleaks); Grafana; alert on oldest pending | Pipeline strip + Grafana screenshot |
| 11 | How we used Claude | Per phase: CLAUDE.md, LLD/ADR, skeptical auditor review, stories, wireframes, tests-first engine, seed data, security review, runbook. One concrete example: "the auditor review found claim splitting, which led to the SPLIT_SUSPECT rule" | Phase timeline |
| 12 | What's next | OCR receipts, SSO/HR sync, real bank file formats, perceptual receipt hash, mobile app, escalation timers | Roadmap |

**Speaker notes:** keep it to 1 minute per slide; the live demo runs between slides 4 and 5, or at the end (7 min, see [demo script](09-Demo-Script.md)).
