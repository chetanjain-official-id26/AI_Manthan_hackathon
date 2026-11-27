package com.expenseflow.policy;

import com.expenseflow.common.security.CurrentUser;
import com.expenseflow.policy.PolicyDtos.RollbackRequest;
import com.expenseflow.policy.PolicyDtos.RuleVersionRequest;
import com.expenseflow.policy.PolicyDtos.RuleView;
import com.expenseflow.policy.PolicyDtos.ThresholdRequest;
import com.expenseflow.policy.PolicyDtos.ThresholdView;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/admin")
public class PolicyAdminController {

    private final PolicyAdminService service;

    public PolicyAdminController(PolicyAdminService service) {
        this.service = service;
    }

    @GetMapping("/policy-rules")
    @PreAuthorize("hasAnyRole('AUDITOR','FINANCE_HEAD')")
    public List<RuleView> rules(@RequestParam(defaultValue = "false") boolean includeHistory) {
        return service.list(includeHistory).stream().map(RuleView::of).toList();
    }

    @PostMapping("/policy-rules/{ruleCode}/versions")
    @PreAuthorize("hasRole('FINANCE_HEAD')")
    @ResponseStatus(HttpStatus.CREATED)
    public RuleView newVersion(@PathVariable String ruleCode, @Valid @RequestBody RuleVersionRequest req) {
        return RuleView.of(service.newVersion(ruleCode, req, CurrentUser.get().id()));
    }

    @PostMapping("/policy-rules/{ruleCode}/rollback")
    @PreAuthorize("hasRole('FINANCE_HEAD')")
    @ResponseStatus(HttpStatus.CREATED)
    public RuleView rollback(@PathVariable String ruleCode, @Valid @RequestBody RollbackRequest req) {
        return RuleView.of(service.rollback(ruleCode, req, CurrentUser.get().id()));
    }

    @GetMapping("/approval-thresholds")
    @PreAuthorize("hasAnyRole('AUDITOR','FINANCE_HEAD')")
    public List<ThresholdView> thresholds() {
        return service.thresholds().stream().map(ThresholdView::of).toList();
    }

    @PostMapping("/approval-thresholds/{level}/versions")
    @PreAuthorize("hasRole('FINANCE_HEAD')")
    @ResponseStatus(HttpStatus.CREATED)
    public ThresholdView newThreshold(@PathVariable String level, @Valid @RequestBody ThresholdRequest req) {
        return ThresholdView.of(service.newThreshold(level, req, CurrentUser.get().id()));
    }
}
