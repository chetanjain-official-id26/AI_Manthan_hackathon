package com.expenseflow.dashboard;

import com.expenseflow.common.security.CurrentUser;
import com.expenseflow.common.time.Ist;
import com.expenseflow.dashboard.DashboardRepository.Amount;
import com.expenseflow.dashboard.DashboardRepository.Count;
import com.expenseflow.dashboard.DashboardRepository.Hours;
import com.expenseflow.dashboard.DashboardRepository.RuleChange;
import com.expenseflow.dashboard.DashboardRepository.Scope;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;
import java.time.LocalDate;
import java.util.List;

/** Dashboard (EF-029/030). Managers see their own team; auditors and the finance head see all. */
@RestController
@RequestMapping("/api/dashboard")
@PreAuthorize("hasAnyRole('MANAGER','AUDITOR','FINANCE_HEAD')")
@Transactional(readOnly = true)
public class DashboardController {

    private final DashboardRepository repo;
    private final Clock clock;

    public DashboardController(DashboardRepository repo, Clock clock) {
        this.repo = repo;
        this.clock = clock;
    }

    private Scope scope(LocalDate from, LocalDate to) {
        CurrentUser u = CurrentUser.get();
        return new Scope(u.seesAll() ? null : u.id(), from, to);
    }

    @GetMapping("/spend-by-category")
    public List<Amount> byCategory(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                   @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return repo.spendByCategory(scope(from, to));
    }

    @GetMapping("/spend-by-department")
    public List<Amount> byDepartment(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                     @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return repo.spendByDepartment(scope(from, to));
    }

    @GetMapping("/spend-by-month")
    public List<Amount> byMonth() {
        return repo.spendByMonth(scope(null, null), Ist.date(clock.instant()));
    }

    @GetMapping("/violations")
    public List<Count> violations(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                  @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return repo.violations(scope(from, to));
    }

    @GetMapping("/approval-time")
    public List<Hours> approvalTime() {
        return repo.approvalTime(scope(null, null));
    }

    @GetMapping("/rule-changes")
    @PreAuthorize("hasAnyRole('AUDITOR','FINANCE_HEAD')")
    public List<RuleChange> ruleChanges() {
        return repo.recentRuleChanges(20);
    }
}
