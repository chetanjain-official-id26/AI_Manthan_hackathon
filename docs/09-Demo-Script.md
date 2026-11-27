# ExpenseFlow — 7-Minute Demo Script

**Presenter:** P5 · **Driver:** P3 · Have the backup video open in a second tab.
Before you start: run a reset, and have the browser tabs pre-logged in as Employee (phone view), Manager, Auditor and Finance Head. Have Grafana open.

| # | Time | Clicks | Talking points | Fallback if it breaks |
|---|---|---|---|---|
| 1 | 0:00–0:40 | Terminal: `docker compose -f ops/docker-compose.yml up -d` (already run) → `docker compose logs seed` | "One command gives us a seeded environment: 150 employees, 8 departments, 3,000 claims, with duplicates and breaches planted on purpose." Show the seed summary. | Show a screenshot of the seed summary |
| 2 | 0:40–1:50 | Employee tab (DevTools at 360 px) → New claim → add Meal 1,200 + receipt, Cab 650 **no receipt**, Hotel tier-1 9,000 for 2 nights → see inline flags → Submit | "Every line is checked as you type. The cab line shows *Receipt required*. Hotel is 4,500 a night, under the tier-1 cap. On submit, the worst line wins, so this claim is policy-rejected with a clear reason." Then copy it to a draft, add the receipt and resubmit. | Open the pre-made claim CLM-DEMO-01 |
| 3 | 1:50–2:50 | Manager → Inbox (oldest first, SLA age) → open the top claim → receipt on the left, WEEKEND flag → Approve (auto-opens next) → on the second claim, **Send back** with a comment | "Oldest first, so nothing rots. The receipt sits beside the lines. Our stopwatch test: __ seconds per claim." | Use the keyboard shortcut `A`; or show the video |
| 4 | 2:50–3:50 | 60,000 claim: manager approves → Auditor queue → filter Flag = DUPLICATE → show the duplicate receipt link → filter Sample only (SAMPLE badge) → select 5 → Bulk approve → per-row results | "Above 25,000 an auditor is added automatically. The receipt hash catches the same bill even when it is renamed. Ten percent of auto-approved claims are sampled at random." | Pre-filtered queue URL bookmarked |
| 5 | 3:50–4:40 | 1,20,000 claim → Finance Head inbox. Show that this claim was approved by the delegate → Audit trail: "approved by X on behalf of Y" → FH approves | "Above 1 lakh the Finance Head signs. Managers on leave delegate; you can never approve your own claim, even as a delegate. Every step is in an append-only trail that the database itself protects." | Show the audit trail screenshot |
| 6 | 4:40–5:30 | Payouts → New batch → select approved → preview totals → Export CSV → open the file → Mark Paid | "Header, one row per employee with masked synthetic bank details, and a trailer with the control total. Marking it Paid moves every claim to PAID." | Open the pre-downloaded CSV |
| 7 | 5:30–6:20 | Dashboard (4 charts + KPIs) → Grafana → oldest pending approval panel → alert firing | "Spend by category, department and month, plus violations and average approval time. In Grafana, an alert fires when an approval waits more than 48 hours." | Grafana screenshot |
| 8 | 6:20–7:00 | Admin → Policy rules → Meal limit 1,500 → 2,000 (reason: "demo") → Employee submits a meal of 1,800 → auto-approved | "Policy is config, not code. The change is versioned and audited, and it takes effect without a deploy." Close: "Built in one day with Claude in every phase." | Explain using the TC-POL-21 test result |

**Cut lines if running late:** drop step 7's Grafana part, and keep steps 1, 2, 4, 6 and 8.
