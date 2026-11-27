package com.expenseflow.approval;

import com.expenseflow.approval.ApproverAuthority.Acting;
import com.expenseflow.audit.AuditEntry;
import com.expenseflow.audit.AuditWriter;
import com.expenseflow.claim.Claim;
import com.expenseflow.claim.ClaimComment;
import com.expenseflow.claim.ClaimCommentRepository;
import com.expenseflow.claim.ClaimStateMachine;
import com.expenseflow.claim.ClaimStatus;
import com.expenseflow.common.Kv;
import com.expenseflow.common.Money;
import com.expenseflow.common.error.ApiException;
import com.expenseflow.common.security.CurrentUser;
import com.expenseflow.common.security.Role;
import com.expenseflow.policy.ConfigService;
import com.expenseflow.policy.Outcome;
import com.expenseflow.policy.engine.PolicyEvaluation;
import com.expenseflow.user.Employee;
import com.expenseflow.user.EmployeeRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.EnumSet;
import java.util.List;
import java.util.Optional;

/**
 * Routing after policy (BR-03..05, BR-20) and approver actions (BR-15..18, ADR-001). Step and
 * claim status change together in one transaction under the claim's optimistic lock.
 */
@Service
public class ApprovalService {

    private final ApprovalStepRepository steps;
    private final ApprovalChainFactory chainFactory;
    private final SampleAuditSelector sampler;
    private final ApproverAuthority authority;
    private final AccessPolicy access;
    private final ClaimStateMachine stateMachine;
    private final ClaimCommentRepository comments;
    private final EmployeeRepository employees;
    private final ConfigService config;
    private final AuditWriter audit;
    private final Clock clock;

    public ApprovalService(ApprovalStepRepository steps, ApprovalChainFactory chainFactory,
                           SampleAuditSelector sampler, ApproverAuthority authority, AccessPolicy access,
                           ClaimStateMachine stateMachine, ClaimCommentRepository comments,
                           EmployeeRepository employees, ConfigService config, AuditWriter audit, Clock clock) {
        this.steps = steps;
        this.chainFactory = chainFactory;
        this.sampler = sampler;
        this.authority = authority;
        this.access = access;
        this.stateMachine = stateMachine;
        this.comments = comments;
        this.employees = employees;
        this.config = config;
        this.audit = audit;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ routing at submit

    @Transactional(propagation = Propagation.MANDATORY)
    public void routeAfterPolicy(Claim claim, PolicyEvaluation ev, Long actorId) {
        Instant now = clock.instant();
        Outcome outcome = ev.claimOutcome();
        if (outcome == Outcome.AUTO_REJECT) {
            stateMachine.transition(claim, ClaimStatus.POLICY_REJECTED, "CLAIM_POLICY_REJECTED", null, null,
                    Kv.of("outcome", outcome.name()));
            return;
        }
        boolean underCap = !Money.gt(claim.getTotalAmount(), config.decimal(ConfigService.AUTO_APPROVE_MAX_TOTAL));
        if (outcome == Outcome.AUTO_APPROVE && underCap) {
            if (sampler.pick()) {
                claim.setSampleAudit(true);
                chainFactory.sampleStep(claim, now);
                stateMachine.transition(claim, ClaimStatus.PENDING_AUDITOR, "CLAIM_SAMPLED_FOR_AUDIT", null, null,
                        Kv.of("sampleAudit", true));
            } else {
                claim.setApprovedAt(now);
                stateMachine.transition(claim, ClaimStatus.APPROVED, "CLAIM_AUTO_APPROVED", null, null, null);
            }
            return;
        }
        ApprovalChainFactory.Chain chain = chainFactory.create(claim, now);
        claim.setSplitSuspect(chain.splitSuspect());
        stateMachine.transition(claim, ClaimStatus.pendingFor(chain.first().getLevel()), "APPROVAL_CHAIN_CREATED",
                null, null, Kv.of("levels", chain.steps().stream().map(ApprovalStep::getLevel).toList(),
                        "cycleNo", claim.getCycleNo(), "splitSuspect", chain.splitSuspect(),
                        "effectiveTotal", chain.effectiveTotal()));
    }

    /** BR-16: on resubmit the remaining steps of the old chain are cancelled. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void cancelOpenSteps(Claim claim) {
        for (ApprovalStep s : steps.findByClaimIdAndStatusIn(claim.getId(),
                EnumSet.of(StepStatus.PENDING, StepStatus.WAITING))) {
            s.setStatus(StepStatus.CANCELLED);
        }
    }

    // ------------------------------------------------------------------ approver actions

    @Transactional
    public Claim approve(Long claimId, int version, String note, CurrentUser user) {
        Ctx ctx = load(claimId, version, user);
        Instant now = clock.instant();
        ApprovalStep step = ctx.step();
        closeStep(step, StepStatus.APPROVED, ctx.acting(), note, now);
        audit.write(stepEvent(ctx, "STEP_APPROVED", note));

        Optional<ApprovalStep> next = steps.findByClaimIdAndCycleNoOrderBySeqAsc(claimId, step.getCycleNo()).stream()
                .filter(s -> s.getStatus() == StepStatus.WAITING).findFirst();
        Claim claim = ctx.claim();
        if (next.isPresent()) {
            next.get().setStatus(StepStatus.PENDING);
            next.get().setActivatedAt(now);
            stateMachine.transition(claim, ClaimStatus.pendingFor(next.get().getLevel()), "CLAIM_ESCALATED",
                    ctx.acting().actorId(), ctx.acting().onBehalfOf(), Kv.of("nextLevel", next.get().getLevel()));
        } else {
            claim.setApprovedAt(now);
            stateMachine.transition(claim, ClaimStatus.APPROVED, "CLAIM_APPROVED", ctx.acting().actorId(),
                    ctx.acting().onBehalfOf(), null);
        }
        return claim;
    }

    @Transactional
    public Claim reject(Long claimId, int version, String reason, CurrentUser user) {
        if (reason == null || reason.isBlank()) {
            throw ApiException.unprocessable("REASON_REQUIRED", "A reason is required to reject");
        }
        Ctx ctx = load(claimId, version, user);
        closeStep(ctx.step(), StepStatus.REJECTED, ctx.acting(), reason, clock.instant());
        cancelWaiting(ctx.claim());
        audit.write(stepEvent(ctx, "STEP_REJECTED", reason));
        stateMachine.transition(ctx.claim(), ClaimStatus.REJECTED, "CLAIM_REJECTED", ctx.acting().actorId(),
                ctx.acting().onBehalfOf(), Kv.of("reason", reason));
        return ctx.claim();
    }

    @Transactional
    public Claim sendBack(Long claimId, int version, String comment, CurrentUser user) {
        if (comment == null || comment.isBlank()) {
            throw ApiException.unprocessable("COMMENT_REQUIRED", "A comment is required to send back");
        }
        Ctx ctx = load(claimId, version, user);
        Instant now = clock.instant();
        closeStep(ctx.step(), StepStatus.SENT_BACK, ctx.acting(), comment, now);
        cancelWaiting(ctx.claim());
        ClaimComment c = new ClaimComment();
        c.setClaimId(claimId);
        c.setAuthorId(user.id());
        c.setBody(comment);
        c.setCreatedAt(now);
        comments.save(c);
        audit.write(stepEvent(ctx, "STEP_SENT_BACK", comment));
        stateMachine.transition(ctx.claim(), ClaimStatus.SENT_BACK, "CLAIM_SENT_BACK", ctx.acting().actorId(),
                ctx.acting().onBehalfOf(), Kv.of("comment", comment));
        return ctx.claim();
    }

    /** R22 / runbook 5.2: the finance head moves a stuck step to another approver at the same level. */
    @Transactional
    public ApprovalStep reassign(Long claimId, Long stepId, Long newAssigneeId, String reason, CurrentUser user) {
        if (!user.has(Role.FINANCE_HEAD)) {
            throw ApiException.forbidden("Only the finance head can reassign a step");
        }
        if (reason == null || reason.isBlank()) {
            throw ApiException.unprocessable("REASON_REQUIRED", "A reason is required to reassign");
        }
        Claim claim = access.visibleClaim(user, claimId);
        ApprovalStep step = steps.findById(stepId).filter(s -> s.getClaimId().equals(claimId))
                .orElseThrow(() -> ApiException.notFound("Step"));
        if (step.getStatus() != StepStatus.PENDING) {
            throw ApiException.unprocessable("STEP_NOT_PENDING", "Only a pending step can be reassigned");
        }
        Employee target = employees.findById(newAssigneeId).filter(Employee::isActive)
                .orElseThrow(() -> ApiException.unprocessable("INVALID_ASSIGNEE", "Unknown or inactive approver"));
        if (target.getId().equals(claim.getEmployeeId())) {
            throw ApiException.unprocessable("SELF_APPROVAL", "The claim owner cannot approve their own claim");
        }
        if (!target.hasRole(Role.valueOf(step.getAssigneeRole()))) {
            throw ApiException.unprocessable("INVALID_ASSIGNEE", "The new approver must hold role " + step.getAssigneeRole());
        }
        Long before = step.getAssigneeId();
        step.setAssigneeId(target.getId());
        audit.write(new AuditEntry(AuditEntry.APPROVAL_STEP, step.getId(), claimId, "STEP_REASSIGNED", user.id(),
                null, Kv.of("assigneeId", before), Kv.of("assigneeId", target.getId(), "reason", reason)));
        return step;
    }

    @Transactional(readOnly = true)
    public List<ApprovalStep> inbox(CurrentUser user) {
        ApproverAuthority.InboxScope scope = authority.inboxScope(user);
        return steps.findInbox(user.id(), scope.assigneeIds(), scope.poolRoles());
    }

    // ------------------------------------------------------------------ helpers

    private record Ctx(Claim claim, ApprovalStep step, Acting acting) {
    }

    /** 404 if not visible, 422 if nothing pending, 403 if not the current approver, 409 if stale. */
    private Ctx load(Long claimId, int version, CurrentUser user) {
        Claim claim = access.visibleClaim(user, claimId);
        ApprovalStep step = steps.findFirstByClaimIdAndStatus(claimId, StepStatus.PENDING)
                .orElseThrow(() -> ApiException.unprocessable("NOT_PENDING", "The claim is not waiting for approval"));
        if (claim.getEmployeeId().equals(user.id())) {
            throw ApiException.forbidden("You cannot act on your own claim");
        }
        Acting acting = authority.resolve(user, step, claim)
                .orElseThrow(() -> ApiException.forbidden("You are not the current approver of this claim"));
        if (claim.getVersion() != version) {
            throw ApiException.staleVersion();
        }
        return new Ctx(claim, step, acting);
    }

    private void closeStep(ApprovalStep step, StepStatus status, Acting acting, String note, Instant now) {
        step.setStatus(status);
        step.setActedBy(acting.actorId());
        step.setOnBehalfOf(acting.onBehalfOf());
        step.setActedAt(now);
        step.setNote(note);
    }

    private void cancelWaiting(Claim claim) {
        for (ApprovalStep s : steps.findByClaimIdAndStatusIn(claim.getId(), EnumSet.of(StepStatus.WAITING))) {
            s.setStatus(StepStatus.CANCELLED);
        }
    }

    private AuditEntry stepEvent(Ctx ctx, String action, String note) {
        ApprovalStep s = ctx.step();
        return new AuditEntry(AuditEntry.APPROVAL_STEP, s.getId(), ctx.claim().getId(), action,
                ctx.acting().actorId(), ctx.acting().onBehalfOf(),
                Kv.of("status", StepStatus.PENDING.name(), "level", s.getLevel(), "claimVersion", ctx.claim().getVersion()),
                Kv.of("status", s.getStatus().name(), "level", s.getLevel(), "note", note));
    }
}
