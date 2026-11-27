package com.expenseflow.claim;

import com.expenseflow.approval.AccessPolicy;
import com.expenseflow.approval.ApprovalService;
import com.expenseflow.claim.ClaimDtos.LineRequest;
import com.expenseflow.common.Kv;
import com.expenseflow.common.Money;
import com.expenseflow.common.error.ApiException;
import com.expenseflow.common.security.CurrentUser;
import com.expenseflow.common.time.Ist;
import com.expenseflow.policy.PolicyService;
import com.expenseflow.policy.engine.PolicyEvaluation;
import com.expenseflow.policy.engine.VendorNormalizer;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.Year;
import java.util.LinkedHashMap;
import java.util.Map;

/** Claim and line lifecycle for the owner (EF-001..005, BR-01..05, BR-16). */
@Service
public class ClaimService {

    private final ClaimRepository claims;
    private final ReceiptRepository receipts;
    private final ClaimCommentRepository comments;
    private final ReceiptStorage storage;
    private final ClaimStateMachine stateMachine;
    private final PolicyService policy;
    private final ApprovalService approvals;
    private final AccessPolicy access;
    private final MeterRegistry meters;
    private final Clock clock;

    public ClaimService(ClaimRepository claims, ReceiptRepository receipts, ClaimCommentRepository comments,
                        ReceiptStorage storage, ClaimStateMachine stateMachine, PolicyService policy,
                        ApprovalService approvals, AccessPolicy access, MeterRegistry meters, Clock clock) {
        this.claims = claims;
        this.receipts = receipts;
        this.comments = comments;
        this.storage = storage;
        this.stateMachine = stateMachine;
        this.policy = policy;
        this.approvals = approvals;
        this.access = access;
        this.meters = meters;
        this.clock = clock;
    }

    @Transactional
    public Claim create(String title, CurrentUser user) {
        Claim c = new Claim();
        c.setEmployeeId(user.id());
        c.setTitle(title.trim());
        c.setClaimNo(String.format("CLM-%d-%06d", Year.now(clock).getValue(), claims.nextClaimNumber()));
        stateMachine.initialise(c);
        claims.save(c);
        stateMachine.record(c, "CLAIM_CREATED", user.id(), null, null,
                Kv.of("status", c.getStatus().name(), "claimNo", c.getClaimNo(), "title", c.getTitle()));
        return c;
    }

    @Transactional
    public Claim updateTitle(Long claimId, String title, int version, CurrentUser user) {
        Claim c = editable(claimId, user, version);
        String before = c.getTitle();
        c.setTitle(title.trim());
        c.setUpdatedAt(clock.instant());
        stateMachine.record(c, "CLAIM_UPDATED", user.id(), null, Kv.of("title", before), Kv.of("title", c.getTitle()));
        return c;
    }

    @Transactional
    public ClaimLine addLine(Long claimId, LineRequest req, CurrentUser user) {
        Claim c = editable(claimId, user, req.version());
        validate(req);
        ClaimLine l = new ClaimLine();
        apply(l, req);
        l.setCreatedAt(clock.instant());
        c.addLine(l);
        c.setUpdatedAt(clock.instant());
        // flush (not save/merge): cascade-persist keeps this instance, so l gets its id
        claims.flush();
        stateMachine.record(c, "LINE_ADDED", user.id(), null, null, lineSnapshot(l));
        return l;
    }

    @Transactional
    public ClaimLine updateLine(Long claimId, Long lineId, LineRequest req, CurrentUser user) {
        Claim c = editable(claimId, user, req.version());
        ClaimLine l = c.line(lineId).orElseThrow(() -> ApiException.notFound("Line"));
        validate(req);
        Map<String, Object> before = lineSnapshot(l);
        apply(l, req);
        c.recomputeTotal();
        c.setUpdatedAt(clock.instant());
        claims.flush(); // write the line while the claim is still editable (the R4 trigger checks status)
        stateMachine.record(c, "LINE_UPDATED", user.id(), null, before, lineSnapshot(l));
        return l;
    }

    @Transactional
    public void deleteLine(Long claimId, Long lineId, CurrentUser user) {
        Claim c = editable(claimId, user, null);
        ClaimLine l = c.line(lineId).orElseThrow(() -> ApiException.notFound("Line"));
        Map<String, Object> before = lineSnapshot(l);
        receipts.findByClaimLineId(lineId).ifPresent(receipts::delete);
        c.removeLine(l);
        c.setUpdatedAt(clock.instant());
        claims.flush();
        stateMachine.record(c, "LINE_REMOVED", user.id(), null, before, null);
    }

    @Transactional
    public Receipt uploadReceipt(Long claimId, Long lineId, byte[] bytes, String originalName, CurrentUser user) {
        Claim c = editable(claimId, user, null);
        c.line(lineId).orElseThrow(() -> ApiException.notFound("Line"));
        ReceiptStorage.Stored stored = storage.store(bytes);
        receipts.findByClaimLineId(lineId).ifPresent(old -> {
            receipts.delete(old);
            receipts.flush();
        });
        Receipt r = new Receipt();
        r.setClaimLineId(lineId);
        r.setStorageKey(stored.storageKey());
        r.setOriginalName(ReceiptStorage.sanitizeName(originalName));
        r.setContentType(stored.contentType());
        r.setSizeBytes(stored.size());
        r.setSha256(stored.sha256());
        r.setUploadedBy(user.id());
        r.setUploadedAt(clock.instant());
        receipts.save(r);
        c.setUpdatedAt(clock.instant());
        stateMachine.record(c, "RECEIPT_UPLOADED", user.id(), null, null,
                Kv.of("lineId", lineId, "receiptId", r.getId(), "sha256", r.getSha256(), "size", r.getSizeBytes()));
        return r;
    }

    @Transactional(readOnly = true)
    public PolicyEvaluation preview(Long claimId, CurrentUser user) {
        return policy.preview(access.ownClaim(user, claimId));
    }

    /** BR-02: submit and evaluate policy in one transaction, then route (BR-03..05). */
    @Transactional
    public Claim submit(Long claimId, int version, CurrentUser user) {
        Claim c = access.ownClaim(user, claimId);
        if (!c.getStatus().editable()) {
            throw ApiException.unprocessable("INVALID_STATE", "Only a draft or sent-back claim can be submitted");
        }
        if (c.getVersion() != version) {
            throw ApiException.staleVersion();
        }
        if (c.getLines().isEmpty()) {
            throw ApiException.unprocessable("NO_LINES", "Add at least one line before submitting");
        }
        LocalDate today = Ist.date(clock.instant());
        Map<String, String> errors = new LinkedHashMap<>();
        for (ClaimLine l : c.getLines()) {
            if (l.getExpenseDate().isAfter(today)) {
                errors.put("lines[" + l.getId() + "].expenseDate", "must not be in the future");
            }
        }
        if (!errors.isEmpty()) {
            throw ApiException.fields(errors);
        }
        boolean resubmit = c.getStatus() == ClaimStatus.SENT_BACK;
        if (resubmit) {
            approvals.cancelOpenSteps(c);
        }
        Instant now = clock.instant();
        c.setCycleNo(c.getCycleNo() + 1);
        c.setSubmittedAt(now);
        c.setApprovedAt(null);
        c.setSampleAudit(false);
        c.setSplitSuspect(false);
        stateMachine.transition(c, ClaimStatus.SUBMITTED, resubmit ? "CLAIM_RESUBMITTED" : "CLAIM_SUBMITTED",
                user.id(), null, Kv.of("cycleNo", c.getCycleNo()));
        PolicyEvaluation ev = policy.evaluateAndPersist(c, user.id());
        approvals.routeAfterPolicy(c, ev, user.id());
        meters.counter("expenseflow.claims.submitted").increment();
        return c;
    }

    /** BR-03: a policy-rejected claim can be copied to a new draft, never edited. */
    @Transactional
    public Claim copyToDraft(Long claimId, CurrentUser user) {
        Claim src = access.ownClaim(user, claimId);
        if (src.getStatus() != ClaimStatus.POLICY_REJECTED && src.getStatus() != ClaimStatus.REJECTED) {
            throw ApiException.unprocessable("INVALID_STATE", "Only a rejected claim can be copied");
        }
        Claim copy = create(src.getTitle() + " (copy)", user);
        for (ClaimLine l : src.getLines()) {
            ClaimLine n = new ClaimLine();
            n.setCategory(l.getCategory());
            n.setAmount(l.getAmount());
            n.setExpenseDate(l.getExpenseDate());
            n.setVendor(l.getVendor());
            n.setVendorNorm(l.getVendorNorm());
            n.setCity(l.getCity());
            n.setCityTier(l.getCityTier());
            n.setNights(l.getNights());
            n.setDescription(l.getDescription());
            n.setCreatedAt(clock.instant());
            copy.addLine(n);
        }
        claims.flush();
        for (int i = 0; i < src.getLines().size(); i++) {
            Long srcLine = src.getLines().get(i).getId();
            Long newLine = copy.getLines().get(i).getId();
            receipts.findByClaimLineId(srcLine).ifPresent(r -> {
                Receipt n = new Receipt();
                n.setClaimLineId(newLine);
                n.setStorageKey(r.getStorageKey());
                n.setOriginalName(r.getOriginalName());
                n.setContentType(r.getContentType());
                n.setSizeBytes(r.getSizeBytes());
                n.setSha256(r.getSha256());
                n.setUploadedBy(user.id());
                n.setUploadedAt(clock.instant());
                receipts.save(n);
            });
        }
        stateMachine.record(copy, "CLAIM_COPIED", user.id(), null, Kv.of("fromClaimId", src.getId()),
                Kv.of("lines", copy.getLines().size(), "total", copy.getTotalAmount()));
        return copy;
    }

    @Transactional
    public ClaimComment comment(Long claimId, String body, CurrentUser user) {
        Claim c = access.visibleClaim(user, claimId);
        ClaimComment cm = new ClaimComment();
        cm.setClaimId(c.getId());
        cm.setAuthorId(user.id());
        cm.setBody(body.trim());
        cm.setCreatedAt(clock.instant());
        comments.save(cm);
        stateMachine.record(c, "COMMENT_ADDED", user.id(), null, null, Kv.of("commentId", cm.getId(), "body", cm.getBody()));
        return cm;
    }

    // ------------------------------------------------------------------ helpers

    /** BR-01: only the owner, only in DRAFT or SENT_BACK. */
    private Claim editable(Long claimId, CurrentUser user, Integer version) {
        Claim c = access.ownClaim(user, claimId);
        if (!c.getStatus().editable()) {
            throw ApiException.unprocessable("CLAIM_LOCKED", "Claim " + c.getClaimNo() + " is " + c.getStatus()
                    + " and cannot be edited");
        }
        if (version != null && c.getVersion() != version) {
            throw ApiException.staleVersion();
        }
        return c;
    }

    private void validate(LineRequest req) {
        Map<String, String> errors = new LinkedHashMap<>();
        if (req.expenseDate().isAfter(Ist.date(clock.instant()))) {
            errors.put("expenseDate", "must not be in the future");
        }
        if (req.category() == Category.HOTEL && (req.nights() == null || req.nights() < 1)) {
            errors.put("nights", "is required for hotel lines");
        }
        if (!errors.isEmpty()) {
            throw ApiException.fields(errors);
        }
    }

    private static void apply(ClaimLine l, LineRequest req) {
        l.setCategory(req.category());
        l.setAmount(Money.scale(req.amount()));
        l.setExpenseDate(req.expenseDate());
        l.setVendor(req.vendor().trim());
        l.setVendorNorm(VendorNormalizer.normalize(req.vendor()));
        l.setCity(req.city() == null ? null : req.city().trim());
        l.setCityTier(req.cityTier());
        l.setNights(req.category() == Category.HOTEL ? req.nights() : null);
        l.setDescription(req.description());
    }

    private static Map<String, Object> lineSnapshot(ClaimLine l) {
        return Kv.of("lineId", l.getId(), "category", l.getCategory(), "amount", l.getAmount(),
                "expenseDate", String.valueOf(l.getExpenseDate()), "vendor", l.getVendor(),
                "cityTier", l.getCityTier(), "nights", l.getNights());
    }
}
