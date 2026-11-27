package com.expenseflow.approval;

import com.expenseflow.approval.AuditorQueueQuery.Filter;
import com.expenseflow.approval.AuditorQueueQuery.QueueSort;
import com.expenseflow.claim.Category;
import com.expenseflow.claim.Claim;
import com.expenseflow.claim.ClaimStatus;
import com.expenseflow.common.error.ApiException;
import com.expenseflow.common.security.CurrentUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

@RestController
@RequestMapping("/api/auditor")
public class AuditorController {

    public static final int MAX_BULK = 100;

    private final AuditorQueueQuery queue;
    private final ApprovalService approvals;

    public AuditorController(AuditorQueueQuery queue, ApprovalService approvals) {
        this.queue = queue;
        this.approvals = approvals;
    }

    @GetMapping("/queue")
    @PreAuthorize("hasAnyRole('AUDITOR','FINANCE_HEAD')")
    public AuditorQueueQuery.Result queue(@RequestParam(required = false) ClaimStatus status,
                                          @RequestParam(required = false) String dept,
                                          @RequestParam(required = false) Category category,
                                          @RequestParam(required = false) BigDecimal min,
                                          @RequestParam(required = false) BigDecimal max,
                                          @RequestParam(required = false) String flag,
                                          @RequestParam(required = false) Boolean sample,
                                          @RequestParam(required = false) Integer ageDays,
                                          @RequestParam(required = false) String sort,
                                          @RequestParam(defaultValue = "0") int page,
                                          @RequestParam(defaultValue = "20") int size) {
        return queue.find(new Filter(status, dept, category, min, max, flag, sample, ageDays,
                QueueSort.parse(sort), page, size));
    }

    public record BulkItem(@NotNull Long claimId, @NotNull Integer version) {
    }

    public record BulkRequest(@NotEmpty List<@Valid BulkItem> items) {
    }

    public record BulkResult(Long claimId, String result, String status, String errorCode, String error) {
    }

    /**
     * EF-024: each claim is approved in its own transaction, so one stale or self-owned claim does
     * not stop the rest. Results are reported per claim.
     */
    @PostMapping("/bulk-approve")
    @PreAuthorize("hasRole('AUDITOR')")
    public List<BulkResult> bulkApprove(@Valid @RequestBody BulkRequest req) {
        if (req.items().size() > MAX_BULK) {
            throw ApiException.badRequest("TOO_MANY_ITEMS", "At most " + MAX_BULK + " claims per bulk approve");
        }
        CurrentUser u = CurrentUser.get();
        List<BulkResult> out = new ArrayList<>();
        for (BulkItem item : req.items()) {
            try {
                Claim c = approvals.approve(item.claimId(), item.version(), "Bulk approved", u);
                out.add(new BulkResult(item.claimId(), "APPROVED", c.getStatus().name(), null, null));
            } catch (ApiException e) {
                out.add(new BulkResult(item.claimId(), "FAILED", null, e.getCode(), e.getMessage()));
            } catch (OptimisticLockingFailureException e) {
                out.add(new BulkResult(item.claimId(), "FAILED", null, "STALE_VERSION",
                        "The claim was changed by someone else"));
            }
        }
        return out;
    }
}
