package com.expenseflow.user;

import com.expenseflow.audit.AuditEntry;
import com.expenseflow.audit.AuditWriter;
import com.expenseflow.common.Kv;
import com.expenseflow.common.error.ApiException;
import com.expenseflow.common.security.CurrentUser;
import com.expenseflow.common.security.Role;
import com.expenseflow.common.time.Ist;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.util.ArrayDeque;
import java.util.Collection;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Delegation while on leave (BR-17, BR-19, R3). */
@Service
public class DelegationService {

    private final DelegationRepository repo;
    private final EmployeeRepository employees;
    private final AuditWriter audit;
    private final Clock clock;

    public DelegationService(DelegationRepository repo, EmployeeRepository employees, AuditWriter audit, Clock clock) {
        this.repo = repo;
        this.employees = employees;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<Delegation> involving(CurrentUser user) {
        return repo.findInvolving(user.id());
    }

    @Transactional
    public Delegation create(Long delegatorId, Long delegateId, LocalDate from, LocalDate to, String reason,
                             CurrentUser actor, boolean byAdmin) {
        Employee delegator = employees.findById(delegatorId).filter(Employee::isActive)
                .orElseThrow(() -> ApiException.unprocessable("INVALID_DELEGATOR", "Unknown or inactive delegator"));
        if (!byAdmin && !(delegator.hasRole(Role.MANAGER) || delegator.hasRole(Role.AUDITOR)
                || delegator.hasRole(Role.FINANCE_HEAD))) {
            throw ApiException.forbidden("Only approvers can delegate");
        }
        if (delegatorId.equals(delegateId)) {
            throw ApiException.unprocessable("SELF_DELEGATION", "You cannot delegate to yourself");
        }
        employees.findById(delegateId).filter(Employee::isActive)
                .orElseThrow(() -> ApiException.unprocessable("INVALID_DELEGATE", "Unknown or inactive delegate"));
        if (to.isBefore(from)) {
            throw ApiException.fields(Map.of("toDate", "must be on or after fromDate"));
        }
        if (to.isBefore(Ist.date(clock.instant()))) {
            throw ApiException.fields(Map.of("toDate", "must not be in the past"));
        }
        List<Delegation> overlapping = repo.findNonRevokedOverlapping(from, to);
        if (overlapping.stream().anyMatch(d -> d.getDelegatorId().equals(delegatorId))) {
            throw ApiException.unprocessable("DELEGATION_OVERLAP", "You already have a delegation for these dates");
        }
        if (createsCycle(overlapping.stream().map(d -> new Edge(d.getDelegatorId(), d.getDelegateId())).toList(),
                delegatorId, delegateId)) {
            throw ApiException.unprocessable("DELEGATION_CYCLE",
                    "This delegation would create a cycle (for example A→B→A)");
        }
        Delegation d = new Delegation();
        d.setDelegatorId(delegatorId);
        d.setDelegateId(delegateId);
        d.setFromDate(from);
        d.setToDate(to);
        d.setReason(reason);
        d.setCreatedBy(actor.id());
        d.setCreatedAt(clock.instant());
        repo.save(d);
        audit.write(new AuditEntry(AuditEntry.DELEGATION, d.getId(), null,
                byAdmin ? "DELEGATION_CREATED_BY_ADMIN" : "DELEGATION_CREATED", actor.id(), null, null,
                Kv.of("delegatorId", delegatorId, "delegateId", delegateId, "fromDate", from.toString(),
                        "toDate", to.toString(), "reason", reason)));
        return d;
    }

    @Transactional
    public void revoke(Long id, CurrentUser user) {
        Delegation d = repo.findById(id)
                .filter(x -> x.getDelegatorId().equals(user.id()) || user.has(Role.FINANCE_HEAD))
                .orElseThrow(() -> ApiException.notFound("Delegation"));
        if (d.isRevoked()) {
            return;
        }
        d.setRevoked(true);
        audit.write(new AuditEntry(AuditEntry.DELEGATION, d.getId(), null, "DELEGATION_REVOKED", user.id(), null,
                Kv.of("revoked", false), Kv.of("revoked", true)));
    }

    public record Edge(Long from, Long to) {
    }

    /** True when adding from→to closes a cycle, i.e. {@code to} already reaches {@code from}. */
    public static boolean createsCycle(Collection<Edge> existing, Long from, Long to) {
        Map<Long, Set<Long>> graph = new HashMap<>();
        for (Edge e : existing) {
            graph.computeIfAbsent(e.from(), k -> new HashSet<>()).add(e.to());
        }
        Deque<Long> stack = new ArrayDeque<>();
        Set<Long> seen = new HashSet<>();
        stack.push(to);
        while (!stack.isEmpty()) {
            Long cur = stack.pop();
            if (cur.equals(from)) {
                return true;
            }
            if (seen.add(cur)) {
                graph.getOrDefault(cur, Set.of()).forEach(stack::push);
            }
        }
        return false;
    }
}
