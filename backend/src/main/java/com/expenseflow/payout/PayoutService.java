package com.expenseflow.payout;

import com.expenseflow.audit.AuditEntry;
import com.expenseflow.audit.AuditWriter;
import com.expenseflow.claim.Claim;
import com.expenseflow.claim.ClaimRepository;
import com.expenseflow.claim.ClaimStateMachine;
import com.expenseflow.claim.ClaimStatus;
import com.expenseflow.common.Kv;
import com.expenseflow.common.error.ApiException;
import com.expenseflow.common.security.CurrentUser;
import com.expenseflow.common.time.Ist;
import com.expenseflow.payout.PayoutBatch.Status;
import com.expenseflow.claim.ReceiptStorage;
import com.expenseflow.user.Employee;
import com.expenseflow.user.EmployeeRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Payout batch lifecycle (BR-21..23, EF-026..028, EF-042). */
@Service
public class PayoutService {

    public static final int MAX_CLAIMS_PER_BATCH = 500;

    private final PayoutBatchRepository batches;
    private final PayoutItemRepository items;
    private final ClaimRepository claims;
    private final EmployeeRepository employees;
    private final ClaimStateMachine stateMachine;
    private final AuditWriter audit;
    private final Clock clock;

    public PayoutService(PayoutBatchRepository batches, PayoutItemRepository items, ClaimRepository claims,
                         EmployeeRepository employees, ClaimStateMachine stateMachine, AuditWriter audit, Clock clock) {
        this.batches = batches;
        this.items = items;
        this.claims = claims;
        this.employees = employees;
        this.stateMachine = stateMachine;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public List<Claim> eligible() {
        return claims.findByStatusOrderByApprovedAtAsc(ClaimStatus.APPROVED);
    }

    @Transactional
    public PayoutBatch create(List<Long> claimIds, CurrentUser user) {
        var ids = new LinkedHashSet<>(claimIds);
        if (ids.isEmpty() || ids.size() > MAX_CLAIMS_PER_BATCH) {
            throw ApiException.unprocessable("INVALID_BATCH_SIZE", "A batch needs 1 to " + MAX_CLAIMS_PER_BATCH
                    + " claims");
        }
        List<Claim> selected = claims.findAllById(ids);
        if (selected.size() != ids.size()) {
            throw ApiException.notFound("Claim");
        }
        for (Claim c : selected) {
            if (c.getStatus() == ClaimStatus.IN_PAYOUT || c.getStatus() == ClaimStatus.PAID) {
                throw ApiException.conflict("ALREADY_BATCHED", "Claim " + c.getClaimNo() + " is already in a batch");
            }
            if (c.getStatus() != ClaimStatus.APPROVED) {
                throw ApiException.unprocessable("NOT_APPROVED", "Claim " + c.getClaimNo() + " is not approved");
            }
        }
        Instant now = clock.instant();
        PayoutBatch b = new PayoutBatch();
        b.setBatchNo("TMP-" + java.util.UUID.randomUUID().toString().substring(0, 12));
        b.setStatus(Status.CREATED);
        b.setClaimCount(selected.size());
        b.setTotalAmount(selected.stream().map(Claim::getTotalAmount).reduce(new BigDecimal("0.00"), BigDecimal::add));
        b.setCreatedBy(user.id());
        b.setCreatedAt(now);
        batches.saveAndFlush(b);
        b.setBatchNo("B" + b.getId());

        List<PayoutItem> rows = new ArrayList<>();
        for (Claim c : selected) {
            PayoutItem it = new PayoutItem();
            it.setBatchId(b.getId());
            it.setClaimId(c.getId());
            it.setEmployeeId(c.getEmployeeId());
            it.setAmount(c.getTotalAmount());
            rows.add(it);
            stateMachine.transition(c, ClaimStatus.IN_PAYOUT, "PAYOUT_ITEM_ADDED", user.id(), null,
                    Kv.of("batchId", b.getId()));
        }
        items.saveAll(rows);
        items.flush(); // the partial unique index (R14) fails here rather than at commit
        audit.write(new AuditEntry(AuditEntry.PAYOUT_BATCH, b.getId(), null, "PAYOUT_BATCH_CREATED", user.id(), null,
                null, Kv.of("batchNo", b.getBatchNo(), "claimCount", b.getClaimCount(), "total", b.getTotalAmount())));
        return b;
    }

    @Transactional(readOnly = true)
    public PayoutBatch get(Long id) {
        return batches.findById(id).orElseThrow(() -> ApiException.notFound("Batch"));
    }

    @Transactional(readOnly = true)
    public List<PayoutBatch> list() {
        return batches.findAllByOrderByIdDesc();
    }

    @Transactional(readOnly = true)
    public List<PayoutItem> items(Long batchId) {
        return items.findByBatchIdOrderByIdAsc(batchId);
    }

    public record Export(String fileName, byte[] content) {
    }

    /** BR-22: exporting does not change claim state. Re-exporting gives the same bytes. */
    @Transactional
    public Export export(Long batchId, CurrentUser user) {
        PayoutBatch b = get(batchId);
        if (b.getStatus() == Status.VOIDED) {
            throw ApiException.unprocessable("BATCH_VOIDED", "A voided batch cannot be exported");
        }
        boolean first = b.getExportedAt() == null;
        if (first) {
            b.setExportedAt(clock.instant());
        }
        List<PayoutItem> its = items.findByBatchIdOrderByIdAsc(batchId);
        Map<Long, Claim> claimById = claims.findAllById(its.stream().map(PayoutItem::getClaimId).toList()).stream()
                .collect(Collectors.toMap(Claim::getId, Function.identity()));
        Map<Long, Employee> empById = employees.findAllById(its.stream().map(PayoutItem::getEmployeeId).toList())
                .stream().collect(Collectors.toMap(Employee::getId, Function.identity()));
        List<BankCsvWriter.Row> rows = its.stream().collect(Collectors.groupingBy(PayoutItem::getEmployeeId))
                .entrySet().stream().map(e -> {
                    Employee emp = empById.get(e.getKey());
                    BigDecimal amount = e.getValue().stream().map(PayoutItem::getAmount)
                            .reduce(BigDecimal.ZERO, BigDecimal::add);
                    List<String> nos = e.getValue().stream().map(i -> claimById.get(i.getClaimId()).getClaimNo()).toList();
                    return new BankCsvWriter.Row(emp.getEmpCode(), emp.getName(), emp.getBankAccountMasked(),
                            emp.getIfsc(), amount, nos);
                }).toList();
        var date = Ist.date(b.getExportedAt());
        byte[] csv = BankCsvWriter.write(b.getId(), date, b.getTotalAmount(), rows);
        String name = BankCsvWriter.fileName(date, b.getId());
        if (first) {
            b.setFileName(name);
            b.setFileSha256(ReceiptStorage.sha256(csv));
            if (b.getStatus() == Status.CREATED) {
                b.setStatus(Status.EXPORTED);
            }
            audit.write(new AuditEntry(AuditEntry.PAYOUT_BATCH, b.getId(), null, "PAYOUT_BATCH_EXPORTED", user.id(),
                    null, Kv.of("status", Status.CREATED.name()),
                    Kv.of("status", b.getStatus().name(), "fileName", name, "sha256", b.getFileSha256())));
        }
        return new Export(name, csv);
    }

    @Transactional
    public PayoutBatch markPaid(Long batchId, int version, CurrentUser user) {
        PayoutBatch b = get(batchId);
        if (b.getStatus() != Status.EXPORTED) {
            throw ApiException.unprocessable("NOT_EXPORTED", "Only an exported batch can be marked paid (status "
                    + b.getStatus() + ")");
        }
        if (b.getVersion() != version) {
            throw ApiException.staleVersion();
        }
        Instant now = clock.instant();
        for (PayoutItem it : items.findByBatchIdOrderByIdAsc(batchId)) {
            Claim c = claims.findById(it.getClaimId()).orElseThrow();
            c.setPaidAt(now);
            stateMachine.transition(c, ClaimStatus.PAID, "CLAIM_PAID", user.id(), null, Kv.of("batchId", batchId));
        }
        b.setStatus(Status.PAID);
        b.setPaidAt(now);
        audit.write(new AuditEntry(AuditEntry.PAYOUT_BATCH, b.getId(), null, "PAYOUT_BATCH_PAID", user.id(), null,
                Kv.of("status", Status.EXPORTED.name()), Kv.of("status", Status.PAID.name())));
        return b;
    }

    /** BR-23 / R14: an unpaid batch can be voided; its claims return to APPROVED. A paid batch cannot. */
    @Transactional
    public PayoutBatch voidBatch(Long batchId, String reason, CurrentUser user) {
        if (reason == null || reason.isBlank()) {
            throw ApiException.unprocessable("REASON_REQUIRED", "A reason is required to void a batch");
        }
        PayoutBatch b = get(batchId);
        if (b.getStatus() == Status.PAID || b.getStatus() == Status.VOIDED) {
            throw ApiException.unprocessable("CANNOT_VOID", "A " + b.getStatus() + " batch cannot be voided");
        }
        Status before = b.getStatus();
        for (PayoutItem it : items.findByBatchIdOrderByIdAsc(batchId)) {
            it.setActive(false);
            Claim c = claims.findById(it.getClaimId()).orElseThrow();
            stateMachine.transition(c, ClaimStatus.APPROVED, "PAYOUT_BATCH_VOIDED", user.id(), null,
                    Kv.of("batchId", batchId, "reason", reason));
        }
        b.setStatus(Status.VOIDED);
        b.setVoidedAt(clock.instant());
        b.setVoidReason(reason);
        audit.write(new AuditEntry(AuditEntry.PAYOUT_BATCH, b.getId(), null, "PAYOUT_BATCH_VOIDED", user.id(), null,
                Kv.of("status", before.name()), Kv.of("status", Status.VOIDED.name(), "reason", reason)));
        return b;
    }
}
