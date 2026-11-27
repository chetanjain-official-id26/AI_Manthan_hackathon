# ADR-001: How approval chains are modelled

**Status:** Accepted · **Date:** 2026-11-27 · **Deciders:** P1, P2 · **Related:** [LLD §2–3](02-LLD.md)

## Context
Routed claims need up to three sequential approvals: manager always, auditor if total > 25,000 INR, and finance head if total > 1,00,000 INR. The model must support:
- delegation while an approver is on leave;
- send back and resubmit, which restarts the chain;
- threshold changes made by finance while claims are in flight;
- an audit record for every step, including "on behalf of";
- a guard against self-approval, plus an approver inbox that loads fast with SLA age.

## Options

### (a) Hard-coded if/else on amount
`if (total > 100000) … else if (total > 25000) …` in the service.
- ➕ Quickest to write.
- ➖ Thresholds live in code, so a change needs a deploy. This breaks the "policy as config" goal.
- ➖ No persisted record of who is expected to approve next, so the inbox has to recompute it on every load.
- ➖ Changing a threshold silently changes which claims are in flight; history can't be explained.

### (b) `approval_step` rows generated at submit from an `approval_threshold` config table
On submit, `ApprovalChainFactory` reads the thresholds and inserts one row per required level (`seq`, `level`, `assignee_id`, `status = PENDING/WAITING`, `cycle_no`).
- ➕ Thresholds are config. Each chain is a **snapshot**, so claims in flight keep the chain they started with.
- ➕ The inbox is a simple indexed query: `approval_step WHERE status = 'PENDING' AND assignee_id IN (me + my active delegators)`.
- ➕ Each step row records who acted, on whose behalf, when, and the note, so it doubles as an audit-friendly history.
- ➕ Fits a small team and is easy to test with Testcontainers.
- ➖ We write our own small state machine and step logic, roughly 300 lines.

### (c) BPMN / workflow engine (Camunda 8, Flowable)
- ➕ Visual models, timers and escalations out of the box.
- ➖ Heavy runtime, a separate data model and a learning curve that doesn't fit a 1-day build.
- ➖ The engine holds process state outside our DB, which complicates the append-only audit and the RBAC checks.
- ➖ Overkill for three linear steps.

## Decision
**Option (b).** We found no strong reason against it.

### Details
1. **Generation.** At submit (T7), insert a step for each threshold row where `total > min_total_exclusive`. The manager step has `min = 0`, so it always applies. Step 1 is `PENDING` and the rest are `WAITING`.
2. **Assignee.**
   - MANAGER: the owner's `manager_id`.
   - AUDITOR: a pool (`assignee_id = null`, `assignee_role = AUDITOR`); any auditor can act.
   - FINANCE_HEAD: the finance head, or the configured alternate if the finance head owns the claim.
3. **Advancing.** Approving step N marks it `APPROVED` (with `acted_by`, `on_behalf_of`, `acted_at`) and sets step N+1 to `PENDING`. If there is no N+1, the claim becomes `APPROVED`. All of this happens in one transaction with optimistic locking on `claim.version`.
4. **Delegation.** It is resolved at **action time, not at generation time**. A user may act on a step if they are the assignee or an active delegate of the assignee (`from_date ≤ today ≤ to_date`, not revoked). `on_behalf_of_id` is set on both the step and the audit row. Delegation does not pass through a chain (A→B, B→C does not give C the power to act for A). Creating a delegation that would form a cycle is rejected.
5. **Self-approval guard.** `actor.id ≠ claim.employee_id`, checked on every action, including for delegates and bulk approve. A delegation does not give someone rights over their own claim.
6. **Send back and resubmit.** Remaining steps become `CANCELLED`. On resubmit, `cycle_no++`, the policy is re-run, and a fresh chain is generated from the **current** thresholds. Edits made after send-back may change the total, so a fresh chain is the safe choice.
7. **Threshold changes mid-flight.** Existing steps are not touched. A new threshold applies only to new submissions and resubmissions. The `approval_threshold` table is versioned like `policy_rule`, and each change writes `THRESHOLD_CHANGED` to the audit trail.
8. **Auditing.** Each step action writes `audit_event(entity_type = APPROVAL_STEP, action = STEP_APPROVED|STEP_REJECTED|STEP_SENT_BACK, actor, on_behalf_of, before, after)` plus a claim-level status event.

## Consequences
- ✅ Thresholds can be changed without a deploy; claim history stays explainable.
- ✅ The inbox, the SLA age (`now − step.activated_at`) and the oldest-pending metric all come from one indexed table.
- ✅ Every boundary (25,000 / 25,000.01 / 1,00,000 / 1,00,000.01) is easy to unit test.
- ⚠️ No built-in timers or escalation. The oldest-pending alert in Prometheus fills the gap, and the finance head can reassign a step manually (runbook procedure).
- ⚠️ The step logic must keep `approval_step.status` and `claim.status` consistent. Both are changed only inside `ClaimStateMachine`, which is covered by tests.
