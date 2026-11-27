package com.expenseflow.approval;

import com.expenseflow.claim.Claim;
import com.expenseflow.claim.ClaimRepository;
import com.expenseflow.common.error.ApiException;
import com.expenseflow.common.security.CurrentUser;
import com.expenseflow.user.Delegation;
import com.expenseflow.user.DelegationRepository;
import com.expenseflow.user.Employee;
import com.expenseflow.user.EmployeeRepository;
import org.springframework.stereotype.Component;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Who may see a claim (BR-26). Anything the caller may not see is reported as 404, never 403
 * (BR-27, R10), so ids cannot be probed.
 */
@Component
public class AccessPolicy {

    private final ClaimRepository claims;
    private final EmployeeRepository employees;
    private final DelegationRepository delegations;
    private final ApprovalStepRepository steps;
    private final ApproverAuthority authority;

    public AccessPolicy(ClaimRepository claims, EmployeeRepository employees, DelegationRepository delegations,
                        ApprovalStepRepository steps, ApproverAuthority authority) {
        this.claims = claims;
        this.employees = employees;
        this.delegations = delegations;
        this.steps = steps;
        this.authority = authority;
    }

    public Claim visibleClaim(CurrentUser user, Long claimId) {
        Claim c = claims.findById(claimId).orElseThrow(() -> ApiException.notFound("Claim"));
        if (!canView(user, c)) {
            throw ApiException.notFound("Claim");
        }
        return c;
    }

    public Claim ownClaim(CurrentUser user, Long claimId) {
        Claim c = claims.findById(claimId).orElseThrow(() -> ApiException.notFound("Claim"));
        if (!c.getEmployeeId().equals(user.id())) {
            if (canView(user, c)) {
                throw ApiException.forbidden("Only the owner can change this claim");
            }
            throw ApiException.notFound("Claim");
        }
        return c;
    }

    public boolean canView(CurrentUser user, Claim c) {
        if (c.getEmployeeId().equals(user.id()) || user.seesAll()) {
            return true;
        }
        Employee owner = employees.findById(c.getEmployeeId()).orElse(null);
        if (owner != null && owner.getManagerId() != null && managerScope(user).contains(owner.getManagerId())) {
            return true;
        }
        var pending = steps.findFirstByClaimIdAndStatus(c.getId(), StepStatus.PENDING);
        if (pending.isPresent() && authority.resolve(user, pending.get(), c).isPresent()) {
            return true;
        }
        // someone who was assigned to or acted on a step keeps read access to that claim
        return steps.existsByClaimIdAndAssigneeIdOrClaimIdAndActedBy(c.getId(), user.id(), c.getId(), user.id());
    }

    /** The user plus managers who delegated to them today: their reportees' claims are visible. */
    public Set<Long> managerScope(CurrentUser user) {
        Set<Long> ids = new LinkedHashSet<>();
        ids.add(user.id());
        List<Delegation> active = delegations.findActiveForDelegate(user.id(), authority.today());
        active.forEach(d -> ids.add(d.getDelegatorId()));
        return ids;
    }
}
