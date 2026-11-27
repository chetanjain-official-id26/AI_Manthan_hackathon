# Skeptical Finance Auditor Review — Approval and Policy Bypass Risks

**Reviewer persona:** Finance auditor with 15 years of fraud-investigation experience
**Scope:** State machine, ERD, ADR-001 and policy config in the [LLD](02-LLD.md)
**Severity:** High = direct financial loss or approval bypass; Med = loss needs collusion or is limited; Low = hygiene

| ID | Bypass / risk | Sev | How to detect | Design fix | Test ID |
|---|---|---|---|---|---|
| R1 | **Claim splitting:** one 40,000 trip filed as two 20,000 claims to avoid the auditor | High | Report of the same employee with ≥ 2 claims whose expense dates overlap within 7 days and whose combined total crosses a threshold | Threshold check uses the **rolling total**: claim total plus the same employee's other claims in flight or approved in the last 7 days with overlapping expense dates. If the combined total crosses a threshold, add that step and set flag `SPLIT_SUSPECT` | TC-SEC-01 |
| R2 | **Self-approval via delegation:** manager M delegates to an employee E, and E approves E's own claim (which is pending with M) | High | `approval_step.acted_by = claim.employee_id` (should be zero rows) | `actor ≠ claim.owner` is checked on every action, regardless of delegation. A delegate cannot see or act on their own claim | TC-SEC-02 |
| R3 | **Delegation loops / chains:** A→B, B→A, so both approve each other's claims | High | Cycle check query on active delegations | Reject cycles when a delegation is created; delegation does not pass along a chain; a delegate cannot be the delegator's reportee whose claims are pending | TC-SEC-03 |
| R4 | **Editing a line after approval** (amount raised once approved) | High | Audit shows `LINE_UPDATED` after `STEP_APPROVED` with no `CLAIM_SENT_BACK` in between | Lines can be edited only in DRAFT/SENT_BACK (checked server-side). Any edit after send-back forces resubmit, re-runs policy and restarts the chain. A DB trigger blocks line updates when the claim status is not in (DRAFT, SENT_BACK) | TC-SEC-04 |
| R5 | **Re-uploading the same receipt with different metadata** (new file name, different vendor/date typed) | High | Same `receipt.sha256` on > 1 line | Hash is taken on raw bytes and duplicates are detected across all employees. Optional: perceptual hash for re-photographed receipts (later work) | TC-POL-13 |
| R6 | **Backdating** expenses (old receipts, or dates chosen to avoid weekend flags) | Med | expense_date > 90 days before submit; expense_date in the future | Rule `STALE_EXPENSE` (config, ROUTE if > 90 days); reject future dates; the receipt hash still catches reuse | TC-POL-16 |
| R7 | **Changing policy config to approve one's own claim** (finance head raises the meal limit, submits, lowers it again) | High | Audit `POLICY_RULE_CHANGED` close in time to the same user's submit | Rule changes need a reason and are audited; editing is blocked while the editor has a claim in SUBMITTED/PENDING; `policy_result` stores the rule version; the dashboard shows recent rule changes; finance head claims always route to the alternate approver | TC-SEC-05 |
| R8 | **Approving via API without the UI** (calling `/approve` directly on any claim id) | High | 403/404 rate on approve endpoints | Every endpoint checks server-side that the caller is the current step's assignee or active delegate. The UI hiding a button is not treated as a control | TC-SEC-06 |
| R9 | **Race on bulk approve / double approval** (two auditors at once, or a double click) | Med | Two `STEP_APPROVED` rows for the same step | Optimistic lock (`@Version`); bulk request carries the version per claim; step update is guarded with `WHERE status = 'PENDING'`; the result is per claim | TC-SEC-07 |
| R10 | **IDOR:** reading other employees' claims or receipts by changing the ID | High | 404 spikes per user in logs | `AccessPolicy.canView` on claims **and** receipts; 404 for not-visible; claim IDs are not trusted from the client | TC-SEC-08 |
| R11 | **Mass assignment:** posting `status: "APPROVED"` or `employeeId` in the claim JSON | High | Unexpected field warnings | Whitelisted DTOs; unknown fields rejected (`FAIL_ON_UNKNOWN_PROPERTIES`); status changes only through the state machine | TC-SEC-09 |
| R12 | **Manager approves for a reportee who is a relative/colluder** (collusion) | Med | Approval rate 100% with low approval time for a pair; dashboard outlier | 10% sample audit; auditor filter "approved < 1 min"; out of scope to prevent fully | TC-SEC-10 |
| R13 | **Changing your own manager_id or roles** | High | Audit on employee changes | Employees cannot edit their own profile fields; the hierarchy is seed/admin only, and changes are audited | TC-SEC-11 |
| R14 | **Paying a claim twice** (claim in two batches, or re-exported after Paid) | High | Same claim_id in > 1 non-void payout_item | Partial unique index on `payout_item.claim_id`; state guard APPROVED → IN_PAYOUT only; a Paid batch cannot be voided | TC-PAY-04 |
| R15 | **Tampering with the audit trail** (DBA or app deletes rows) | High | Row count / hash chain check | Trigger plus no UPDATE/DELETE grant for the app role. Optional: hash chain column (`prev_hash`) for tamper evidence | TC-SEC-12 |
| R16 | **Splitting meals across claims** to stay under 1,500/day | Med | Same employee, same date, MEAL, multiple claims | The meal rule sums across all of the employee's non-draft claims for that date | TC-POL-04 |
| R17 | **Withholding a receipt just under the threshold** (many 499 lines) | Low | Distribution spike at 490–500 | Dashboard histogram; auditor filter "amount 450–500"; rule tuning | TC-POL-17 |
| R18 | **Malicious file upload** (HTML/SVG with script, path traversal in file name) | Med | Upload rejections in logs | Magic-byte sniffing, only PDF/JPG/PNG, UUID storage key, served as an attachment with `X-Content-Type-Options: nosniff` | TC-SEC-13 |
| R19 | **CSV injection** in the payout file (vendor/name starting with `=`) | Med | Fields starting with `= + - @` | Escape with a leading `'` | TC-PAY-05 |
| R20 | **Stolen or forged JWT / weak secret** | High | gitleaks; startup check | Secret from env, ≥ 32 bytes, app refuses to start otherwise; 60-min expiry; demo login disabled outside the `demo` profile | TC-SEC-14 |
| R21 | **Sample audit is predictable** (employee learns the seed) | Low | — | `SecureRandom` in prod; seed only in tests | TC-AUD-03 |
| R22 | **Approver on leave with no delegate**, so claims stall and someone pushes them through informally | Med | Oldest pending > 48 h alert | Alert, plus a finance head reassignment procedure (audited) in the runbook | TC-APR-12 |

## Summary
- **High:** 14 · **Med:** 6 · **Low:** 2
- The design fixes are reflected in the LLD (§2 guards, §3.2 rule versioning, §4 constraints, §11 security), and each has a test ID in the [Test Plan](06-Test-Plan.md).
- Accepted residual risk: collusion between a manager and an employee (R12) is reduced by the sample audit, not prevented.
