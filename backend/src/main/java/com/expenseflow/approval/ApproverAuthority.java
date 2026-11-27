package com.expenseflow.approval;

import com.expenseflow.claim.Claim;
import com.expenseflow.common.security.CurrentUser;
import com.expenseflow.common.security.Role;
import com.expenseflow.common.time.Ist;
import com.expenseflow.user.Delegation;
import com.expenseflow.user.DelegationRepository;
import com.expenseflow.user.Employee;
import com.expenseflow.user.EmployeeRepository;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Decides whether a user may act on a step (ADR-001 §4–5). Delegation is resolved at action time,
 * does not chain, and never gives anyone rights over their own claim.
 */
@Component
public class ApproverAuthority {

    /** The user may act; {@code onBehalfOf} is the delegator, or null when acting directly. */
    public record Acting(Long actorId, Long onBehalfOf) {
    }

    private final DelegationRepository delegations;
    private final EmployeeRepository employees;
    private final Clock clock;

    public ApproverAuthority(DelegationRepository delegations, EmployeeRepository employees, Clock clock) {
        this.delegations = delegations;
        this.employees = employees;
        this.clock = clock;
    }

    public LocalDate today() {
        return Ist.date(clock.instant());
    }

    public Optional<Acting> resolve(CurrentUser user, ApprovalStep step, Claim claim) {
        if (user.id().equals(claim.getEmployeeId())) {
            return Optional.empty(); // BR-18: never on your own claim, directly or as a delegate
        }
        if (directlyAssigned(user.id(), user.roles(), step)) {
            return Optional.of(new Acting(user.id(), null));
        }
        for (Delegation d : delegations.findActiveForDelegate(user.id(), today())) {
            if (d.getDelegatorId().equals(claim.getEmployeeId())) {
                continue;
            }
            // Only the delegator's OWN rights pass across; the delegator's delegations do not (BR-19).
            Optional<Employee> delegator = employees.findById(d.getDelegatorId());
            if (delegator.isPresent() && delegator.get().isActive()
                    && directlyAssigned(delegator.get().getId(), delegator.get().roleSet(), step)) {
                return Optional.of(new Acting(user.id(), d.getDelegatorId()));
            }
        }
        return Optional.empty();
    }

    static boolean directlyAssigned(Long userId, Set<Role> roles, ApprovalStep step) {
        if (step.getAssigneeId() != null) {
            return step.getAssigneeId().equals(userId);
        }
        return roles.contains(Role.valueOf(step.getAssigneeRole()));
    }

    /** Ids and pool roles whose pending steps belong in this user's inbox. */
    public record InboxScope(Set<Long> assigneeIds, Set<String> poolRoles, List<Long> delegatorIds) {
    }

    public InboxScope inboxScope(CurrentUser user) {
        Set<Long> ids = new LinkedHashSet<>();
        Set<String> roles = new LinkedHashSet<>();
        List<Long> delegators = new ArrayList<>();
        ids.add(user.id());
        addApproverRoles(user.roles(), roles);
        for (Delegation d : delegations.findActiveForDelegate(user.id(), today())) {
            employees.findById(d.getDelegatorId()).filter(Employee::isActive).ifPresent(e -> {
                ids.add(e.getId());
                delegators.add(e.getId());
                addApproverRoles(e.roleSet(), roles);
            });
        }
        if (roles.isEmpty()) {
            roles.add("__NONE__"); // keeps the IN clause valid
        }
        return new InboxScope(ids, roles, delegators);
    }

    private static void addApproverRoles(Set<Role> from, Set<String> into) {
        for (Role r : EnumSet.of(Role.MANAGER, Role.AUDITOR, Role.FINANCE_HEAD)) {
            if (from.contains(r)) {
                into.add(r.name());
            }
        }
    }
}
