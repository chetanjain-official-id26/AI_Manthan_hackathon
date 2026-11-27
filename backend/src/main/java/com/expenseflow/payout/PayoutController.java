package com.expenseflow.payout;

import com.expenseflow.claim.ClaimDtos.ClaimSummary;
import com.expenseflow.claim.ClaimQueryService;
import com.expenseflow.common.security.CurrentUser;
import com.expenseflow.common.time.Ist;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/payouts")
@PreAuthorize("hasRole('FINANCE_HEAD')")
public class PayoutController {

    private final PayoutService service;
    private final ClaimQueryService claims;

    public PayoutController(PayoutService service, ClaimQueryService claims) {
        this.service = service;
        this.claims = claims;
    }

    public record CreateBatchRequest(@NotEmpty List<@NotNull Long> claimIds) {
    }

    public record MarkPaidRequest(@NotNull Integer version) {
    }

    public record VoidRequest(@Size(max = 300) String reason) {
    }

    public record ItemView(Long claimId, Long employeeId, BigDecimal amount, boolean active) {
    }

    public record BatchView(Long id, String batchNo, String status, int claimCount, BigDecimal totalAmount,
                            String fileName, String fileSha256, OffsetDateTime createdAt, OffsetDateTime exportedAt,
                            OffsetDateTime paidAt, OffsetDateTime voidedAt, String voidReason, int version,
                            List<ItemView> items) {
    }

    @GetMapping("/eligible")
    public List<ClaimSummary> eligible() {
        var list = service.eligible();
        var names = claims.names(list.stream().map(c -> c.getEmployeeId()).toList());
        return list.stream().map(c -> claims.summary(c, names)).toList();
    }

    @GetMapping
    public List<BatchView> list() {
        return service.list().stream().map(b -> view(b, false)).toList();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public BatchView create(@Valid @RequestBody CreateBatchRequest req) {
        return view(service.create(req.claimIds(), CurrentUser.get()), true);
    }

    @GetMapping("/{id}")
    public BatchView get(@PathVariable Long id) {
        return view(service.get(id), true);
    }

    @GetMapping("/{id}/csv")
    public ResponseEntity<byte[]> csv(@PathVariable Long id) {
        PayoutService.Export e = service.export(id, CurrentUser.get());
        return ResponseEntity.ok()
                .contentType(new MediaType("text", "csv", java.nio.charset.StandardCharsets.UTF_8))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(e.fileName()).build().toString())
                .body(e.content());
    }

    @PostMapping("/{id}/mark-paid")
    public BatchView markPaid(@PathVariable Long id, @Valid @RequestBody MarkPaidRequest req) {
        return view(service.markPaid(id, req.version(), CurrentUser.get()), true);
    }

    @PostMapping("/{id}/void")
    public BatchView voidBatch(@PathVariable Long id, @Valid @RequestBody VoidRequest req) {
        return view(service.voidBatch(id, req.reason(), CurrentUser.get()), true);
    }

    private BatchView view(PayoutBatch b, boolean withItems) {
        List<ItemView> its = withItems ? service.items(b.getId()).stream()
                .map(i -> new ItemView(i.getClaimId(), i.getEmployeeId(), i.getAmount(), i.isActive())).toList()
                : List.of();
        return new BatchView(b.getId(), b.getBatchNo(), b.getStatus().name(), b.getClaimCount(), b.getTotalAmount(),
                b.getFileName(), b.getFileSha256(), Ist.render(b.getCreatedAt()), Ist.render(b.getExportedAt()),
                Ist.render(b.getPaidAt()), Ist.render(b.getVoidedAt()), b.getVoidReason(), b.getVersion(), its);
    }
}
