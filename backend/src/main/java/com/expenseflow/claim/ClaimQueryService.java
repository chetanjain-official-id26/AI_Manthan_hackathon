package com.expenseflow.claim;

import com.expenseflow.approval.AccessPolicy;
import com.expenseflow.approval.ApprovalStep;
import com.expenseflow.approval.ApprovalStepRepository;
import com.expenseflow.approval.ApproverAuthority;
import com.expenseflow.approval.StepStatus;
import com.expenseflow.claim.ClaimDtos.*;
import com.expenseflow.common.error.ApiException;
import com.expenseflow.common.security.CurrentUser;
import com.expenseflow.common.time.Ist;
import com.expenseflow.policy.PolicyResult;
import com.expenseflow.policy.PolicyResultRepository;
import com.expenseflow.policy.engine.PolicyEvaluation;
import com.expenseflow.user.Employee;
import com.expenseflow.user.EmployeeRepository;
import jakarta.persistence.criteria.Predicate;
import jakarta.persistence.criteria.Subquery;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/** Read models for claims, scoped by {@link AccessPolicy} (BR-26). */
@Service
@Transactional(readOnly = true)
public class ClaimQueryService {

    /** Whitelisted sort keys (CLAUDE.md rule 10). */
    public enum ClaimSort {
        NEWEST(Sort.by(Sort.Direction.DESC, "createdAt", "id")),
        OLDEST(Sort.by(Sort.Direction.ASC, "createdAt", "id")),
        SUBMITTED(Sort.by(Sort.Direction.DESC, "submittedAt", "id")),
        AMOUNT_DESC(Sort.by(Sort.Direction.DESC, "totalAmount", "id")),
        AMOUNT_ASC(Sort.by(Sort.Direction.ASC, "totalAmount", "id"));

        final Sort sort;

        ClaimSort(Sort sort) {
            this.sort = sort;
        }

        public static ClaimSort parse(String s) {
            if (s == null || s.isBlank()) {
                return NEWEST;
            }
            try {
                return valueOf(s.trim().toUpperCase());
            } catch (IllegalArgumentException e) {
                throw ApiException.badRequest("INVALID_SORT", "Unsupported sort: allowed values are "
                        + List.of(values()));
            }
        }
    }

    private final ClaimRepository claims;
    private final ClaimLineRepository lines;
    private final ReceiptRepository receipts;
    private final PolicyResultRepository results;
    private final ApprovalStepRepository steps;
    private final ClaimCommentRepository comments;
    private final EmployeeRepository employees;
    private final AccessPolicy access;
    private final ApproverAuthority authority;

    public ClaimQueryService(ClaimRepository claims, ClaimLineRepository lines, ReceiptRepository receipts,
                             PolicyResultRepository results, ApprovalStepRepository steps,
                             ClaimCommentRepository comments, EmployeeRepository employees, AccessPolicy access,
                             ApproverAuthority authority) {
        this.claims = claims;
        this.lines = lines;
        this.receipts = receipts;
        this.results = results;
        this.steps = steps;
        this.comments = comments;
        this.employees = employees;
        this.access = access;
        this.authority = authority;
    }

    public PageView<ClaimSummary> list(CurrentUser user, boolean mine, ClaimStatus status, int page, int size,
                                       ClaimSort sort) {
        if (page < 0 || size < 1 || size > 100) {
            throw ApiException.badRequest("INVALID_PAGE", "page must be ≥ 0 and size between 1 and 100");
        }
        Specification<Claim> spec = scope(user, mine);
        if (status != null) {
            spec = spec.and((root, q, cb) -> cb.equal(root.get("status"), status));
        }
        Page<Claim> p = claims.findAll(spec, PageRequest.of(page, size, sort.sort));
        Map<Long, String> names = names(p.getContent().stream().map(Claim::getEmployeeId).toList());
        return PageView.of(p.map(c -> summary(c, names)));
    }

    private Specification<Claim> scope(CurrentUser user, boolean mine) {
        if (!mine && user.seesAll()) {
            return (root, q, cb) -> cb.conjunction();
        }
        Set<Long> managers = access.managerScope(user);
        if (mine || (!user.has(com.expenseflow.common.security.Role.MANAGER) && managers.size() == 1)) {
            return (root, q, cb) -> cb.equal(root.get("employeeId"), user.id());
        }
        return (root, q, cb) -> {
            Subquery<Long> reportees = q.subquery(Long.class);
            var e = reportees.from(Employee.class);
            reportees.select(e.get("id")).where(e.get("managerId").in(managers));
            Predicate own = cb.equal(root.get("employeeId"), user.id());
            return cb.or(own, root.get("employeeId").in(reportees));
        };
    }

    public ClaimDetail detail(Long claimId, CurrentUser user) {
        Claim c = access.visibleClaim(user, claimId);
        List<Long> lineIds = c.getLines().stream().map(ClaimLine::getId).toList();
        Map<Long, Receipt> receiptByLine = lineIds.isEmpty() ? Map.of()
                : receipts.findByClaimLineIdIn(lineIds).stream()
                .collect(Collectors.toMap(Receipt::getClaimLineId, Function.identity()));
        Map<Long, List<PolicyResult>> resultsByLine = lineIds.isEmpty() || c.getCycleNo() == 0 ? Map.of()
                : results.findByClaimLineIdInAndEvaluationNoOrderByIdAsc(lineIds, c.getCycleNo()).stream()
                .collect(Collectors.groupingBy(PolicyResult::getClaimLineId));

        List<ApprovalStep> stepRows = steps.findByClaimIdOrderByCycleNoAscSeqAsc(claimId);
        List<ClaimComment> commentRows = comments.findByClaimIdOrderByIdAsc(claimId);
        Set<Long> people = new HashSet<>();
        people.add(c.getEmployeeId());
        stepRows.forEach(s -> Stream.of(s.getAssigneeId(), s.getActedBy(), s.getOnBehalfOf())
                .filter(Objects::nonNull).forEach(people::add));
        commentRows.forEach(cm -> people.add(cm.getAuthorId()));
        Map<Long, String> names = names(people);

        List<LineView> lines = c.getLines().stream().map(l -> new LineView(l.getId(), l.getCategory(), l.getAmount(),
                l.getExpenseDate(), l.getVendor(), l.getCity(), l.getCityTier(), l.getNights(), l.getDescription(),
                l.getLineOutcome(), receiptView(receiptByLine.get(l.getId())),
                resultsByLine.getOrDefault(l.getId(), List.of()).stream().map(ClaimQueryService::resultView).toList()))
                .toList();
        List<StepView> stepViews = stepRows.stream().map(s -> new StepView(s.getId(), s.getSeq(), s.getLevel(),
                s.getAssigneeId(), names.get(s.getAssigneeId()), s.getAssigneeRole(), s.getStatus(), s.getActedBy(),
                names.get(s.getActedBy()), s.getOnBehalfOf(), names.get(s.getOnBehalfOf()),
                Ist.render(s.getActivatedAt()), Ist.render(s.getActedAt()), s.getNote(), s.getCycleNo())).toList();
        List<CommentView> commentViews = commentRows.stream().map(cm -> new CommentView(cm.getId(), cm.getAuthorId(),
                names.get(cm.getAuthorId()), cm.getBody(), Ist.render(cm.getCreatedAt()))).toList();

        boolean owner = c.getEmployeeId().equals(user.id());
        var acting = stepRows.stream().filter(s -> s.getStatus() == StepStatus.PENDING).findFirst()
                .flatMap(s -> authority.resolve(user, s, c));
        Permissions perms = new Permissions(owner && c.getStatus().editable(),
                owner && c.getStatus().editable() && !c.getLines().isEmpty(), acting.isPresent(),
                acting.map(ApproverAuthority.Acting::onBehalfOf).orElse(null),
                owner && (c.getStatus() == ClaimStatus.POLICY_REJECTED || c.getStatus() == ClaimStatus.REJECTED));
        return new ClaimDetail(summary(c, names), lines, stepViews, commentViews, perms);
    }

    public PreviewView preview(PolicyEvaluation ev) {
        return new PreviewView(ev.claimOutcome(), ev.lineOutcomes().entrySet().stream()
                .map(e -> new LinePreview(e.getKey(), e.getValue(), ev.hitsFor(e.getKey()).stream()
                        .map(h -> new ResultView(h.ruleCode(), h.ruleVersion(), h.outcome(), h.flag(), h.reason(),
                                h.relatedLineId())).toList()))
                .toList());
    }

    public ClaimSummary summary(Claim c) {
        return summary(c, names(List.of(c.getEmployeeId())));
    }

    public ClaimSummary summary(Claim c, Map<Long, String> names) {
        return new ClaimSummary(c.getId(), c.getClaimNo(), c.getTitle(), c.getStatus(), c.getTotalAmount(),
                c.getEmployeeId(), names.get(c.getEmployeeId()), c.isSampleAudit(), c.isSplitSuspect(),
                c.getPolicyOutcome(), c.getCycleNo(), Ist.render(c.getSubmittedAt()), Ist.render(c.getApprovedAt()),
                Ist.render(c.getCreatedAt()), c.getVersion());
    }

    public Map<Long, String> names(Collection<Long> ids) {
        Set<Long> unique = ids.stream().filter(Objects::nonNull).collect(Collectors.toSet());
        Map<Long, String> m = new java.util.HashMap<>(); // HashMap: get(null) must return null, not throw
        if (!unique.isEmpty()) {
            employees.findAllById(unique).forEach(e -> m.put(e.getId(), e.getName()));
        }
        return m;
    }

    static ReceiptView receiptView(Receipt r) {
        return r == null ? null
                : new ReceiptView(r.getId(), r.getOriginalName(), r.getContentType(), r.getSizeBytes(), r.getSha256());
    }

    static ResultView resultView(PolicyResult r) {
        return new ResultView(r.getRuleCode(), r.getRuleVersion(), r.getOutcome(), r.getFlag(), r.getReason(),
                r.getRelatedLineId());
    }

    /** Receipt download is scoped exactly like the claim (R10). */
    public Receipt visibleReceipt(Long receiptId, CurrentUser user) {
        Receipt r = receipts.findById(receiptId).orElseThrow(() -> ApiException.notFound("Receipt"));
        Long claimId = lines.findClaimIdByLineId(r.getClaimLineId());
        Claim c = claimId == null ? null : claims.findById(claimId).orElse(null);
        if (c == null) {
            throw ApiException.notFound("Receipt");
        }
        if (!access.canView(user, c)) {
            throw ApiException.notFound("Receipt");
        }
        return r;
    }
}
