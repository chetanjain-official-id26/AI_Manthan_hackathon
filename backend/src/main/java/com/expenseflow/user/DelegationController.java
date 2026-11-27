package com.expenseflow.user;

import com.expenseflow.common.security.CurrentUser;
import com.expenseflow.common.time.Ist;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

@RestController
@RequestMapping("/api")
public class DelegationController {

    private final DelegationService service;
    private final EmployeeRepository employees;

    public DelegationController(DelegationService service, EmployeeRepository employees) {
        this.service = service;
        this.employees = employees;
    }

    public record DelegationRequest(@NotNull Long delegateId, @NotNull LocalDate fromDate, @NotNull LocalDate toDate,
                                    @Size(max = 300) String reason) {
    }

    public record AdminDelegationRequest(@NotNull Long delegatorId, @NotNull Long delegateId,
                                         @NotNull LocalDate fromDate, @NotNull LocalDate toDate,
                                         @NotNull @Size(min = 1, max = 300) String reason) {
    }

    public record DelegationView(Long id, Long delegatorId, String delegatorName, Long delegateId,
                                 String delegateName, LocalDate fromDate, LocalDate toDate, String reason,
                                 boolean revoked, OffsetDateTime createdAt) {
    }

    @GetMapping("/delegations")
    public List<DelegationView> mine() {
        return service.involving(CurrentUser.get()).stream().map(this::view).toList();
    }

    @PostMapping("/delegations")
    @PreAuthorize("hasAnyRole('MANAGER','AUDITOR','FINANCE_HEAD')")
    @ResponseStatus(HttpStatus.CREATED)
    public DelegationView create(@Valid @RequestBody DelegationRequest req) {
        CurrentUser u = CurrentUser.get();
        return view(service.create(u.id(), req.delegateId(), req.fromDate(), req.toDate(), req.reason(), u, false));
    }

    /** Runbook 5.2: the finance head sets a delegation for an absent approver. */
    @PostMapping("/admin/delegations")
    @PreAuthorize("hasRole('FINANCE_HEAD')")
    @ResponseStatus(HttpStatus.CREATED)
    public DelegationView createForOther(@Valid @RequestBody AdminDelegationRequest req) {
        CurrentUser u = CurrentUser.get();
        return view(service.create(req.delegatorId(), req.delegateId(), req.fromDate(), req.toDate(), req.reason(),
                u, true));
    }

    @DeleteMapping("/delegations/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revoke(@PathVariable Long id) {
        service.revoke(id, CurrentUser.get());
    }

    private DelegationView view(Delegation d) {
        String a = employees.findById(d.getDelegatorId()).map(Employee::getName).orElse(null);
        String b = employees.findById(d.getDelegateId()).map(Employee::getName).orElse(null);
        return new DelegationView(d.getId(), d.getDelegatorId(), a, d.getDelegateId(), b, d.getFromDate(),
                d.getToDate(), d.getReason(), d.isRevoked(), Ist.render(d.getCreatedAt()));
    }
}
