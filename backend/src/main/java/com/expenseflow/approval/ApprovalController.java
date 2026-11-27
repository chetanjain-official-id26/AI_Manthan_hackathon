package com.expenseflow.approval;

import com.expenseflow.claim.Claim;
import com.expenseflow.claim.ClaimDtos.ApproveRequest;
import com.expenseflow.claim.ClaimDtos.ClaimDetail;
import com.expenseflow.claim.ClaimDtos.ReassignRequest;
import com.expenseflow.claim.ClaimDtos.RejectRequest;
import com.expenseflow.claim.ClaimDtos.SendBackRequest;
import com.expenseflow.claim.ClaimQueryService;
import com.expenseflow.claim.ClaimRepository;
import com.expenseflow.common.error.ApiException;
import com.expenseflow.common.security.CurrentUser;
import com.expenseflow.common.time.Ist;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@RestController
@RequestMapping("/api")
public class ApprovalController {

    private final ApprovalService approvals;
    private final ClaimQueryService query;
    private final ClaimRepository claims;
    private final Clock clock;

    public ApprovalController(ApprovalService approvals, ClaimQueryService query, ClaimRepository claims,
                              Clock clock) {
        this.approvals = approvals;
        this.query = query;
        this.claims = claims;
        this.clock = clock;
    }

    @PostMapping("/claims/{id}/approve")
    public ClaimDetail approve(@PathVariable Long id, @Valid @RequestBody ApproveRequest req) {
        CurrentUser u = CurrentUser.get();
        approvals.approve(id, req.version(), req.note(), u);
        return query.detail(id, u);
    }

    @PostMapping("/claims/{id}/reject")
    public ClaimDetail reject(@PathVariable Long id, @Valid @RequestBody RejectRequest req) {
        CurrentUser u = CurrentUser.get();
        approvals.reject(id, req.version(), req.reason(), u);
        return query.detail(id, u);
    }

    @PostMapping("/claims/{id}/send-back")
    public ClaimDetail sendBack(@PathVariable Long id, @Valid @RequestBody SendBackRequest req) {
        CurrentUser u = CurrentUser.get();
        approvals.sendBack(id, req.version(), req.comment(), u);
        return query.detail(id, u);
    }

    @PostMapping("/claims/{id}/steps/{stepId}/reassign")
    public ClaimDetail reassign(@PathVariable Long id, @PathVariable Long stepId,
                                @Valid @RequestBody ReassignRequest req) {
        CurrentUser u = CurrentUser.get();
        approvals.reassign(id, stepId, req.assigneeId(), req.reason(), u);
        return query.detail(id, u);
    }

    public record InboxItem(Long stepId, Long claimId, String claimNo, String title, Long employeeId,
                            String employeeName, String level, BigDecimal totalAmount, String status,
                            boolean sampleAudit, boolean splitSuspect, OffsetDateTime activatedAt, long ageHours,
                            Long onBehalfOf, String onBehalfOfName, int claimVersion) {
    }

    /** EF-015: pending steps for me and my active delegators, oldest first with SLA age. */
    @GetMapping("/approvals/inbox")
    public List<InboxItem> inbox(@RequestParam(defaultValue = "age") String sort) {
        if (!"age".equals(sort)) {
            throw ApiException.badRequest("INVALID_SORT", "Only sort=age is supported");
        }
        CurrentUser u = CurrentUser.get();
        List<ApprovalStep> steps = approvals.inbox(u);
        Map<Long, Claim> byId = claims.findAllById(steps.stream().map(ApprovalStep::getClaimId).toList()).stream()
                .collect(Collectors.toMap(Claim::getId, Function.identity()));
        Map<Long, String> names = query.names(Stream.concat(byId.values().stream().map(Claim::getEmployeeId),
                steps.stream().map(ApprovalStep::getAssigneeId).filter(Objects::nonNull)).toList());
        var now = clock.instant();
        return steps.stream().map(s -> {
            Claim c = byId.get(s.getClaimId());
            Long behalf = s.getAssigneeId() != null && !s.getAssigneeId().equals(u.id()) ? s.getAssigneeId() : null;
            return new InboxItem(s.getId(), c.getId(), c.getClaimNo(), c.getTitle(), c.getEmployeeId(),
                    names.get(c.getEmployeeId()), s.getLevel(), c.getTotalAmount(), c.getStatus().name(),
                    c.isSampleAudit(), c.isSplitSuspect(), Ist.render(s.getActivatedAt()),
                    s.getActivatedAt() == null ? 0 : Duration.between(s.getActivatedAt(), now).toHours(),
                    behalf, names.get(behalf), c.getVersion());
        }).toList();
    }
}
