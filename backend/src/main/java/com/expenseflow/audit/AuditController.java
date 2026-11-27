package com.expenseflow.audit;

import com.expenseflow.approval.AccessPolicy;
import com.expenseflow.claim.ClaimDtos.PageView;
import com.expenseflow.common.error.ApiException;
import com.expenseflow.common.security.CurrentUser;
import com.expenseflow.common.time.Ist;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.time.LocalDate;
import java.time.OffsetDateTime;

/**
 * Read-only audit viewer (EF-032). Auditor and finance head see everything; anyone else may only
 * read the trail of a claim they can see (owner, manager).
 */
@RestController
@RequestMapping("/api/audit")
@Transactional(readOnly = true)
public class AuditController {

    private final AuditEventRepository repo;
    private final AccessPolicy access;
    private final JsonMapper json;

    public AuditController(AuditEventRepository repo, AccessPolicy access, JsonMapper json) {
        this.repo = repo;
        this.access = access;
        this.json = json;
    }

    public record AuditView(Long id, String entityType, Long entityId, Long claimId, String action, Long actorId,
                            Long onBehalfOfId, JsonNode before, JsonNode after, String requestId,
                            OffsetDateTime createdAt) {
    }

    @GetMapping
    public PageView<AuditView> search(@RequestParam(required = false) Long claimId,
                                      @RequestParam(required = false) Long actorId,
                                      @RequestParam(required = false) String action,
                                      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                      @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,
                                      @RequestParam(defaultValue = "0") int page,
                                      @RequestParam(defaultValue = "50") int size) {
        CurrentUser u = CurrentUser.get();
        if (!u.seesAll()) {
            if (claimId == null) {
                throw ApiException.forbidden("Filter by a claim you can see");
            }
            access.visibleClaim(u, claimId); // 404 when not visible
        }
        if (page < 0 || size < 1 || size > 200) {
            throw ApiException.badRequest("INVALID_PAGE", "page must be ≥ 0 and size between 1 and 200");
        }
        Specification<AuditEvent> spec = (root, q, cb) -> cb.conjunction();
        if (claimId != null) {
            spec = spec.and((root, q, cb) -> cb.equal(root.get("claimId"), claimId));
        }
        if (actorId != null) {
            spec = spec.and((root, q, cb) -> cb.or(cb.equal(root.get("actorId"), actorId),
                    cb.equal(root.get("onBehalfOfId"), actorId)));
        }
        if (action != null && !action.isBlank()) {
            spec = spec.and((root, q, cb) -> cb.equal(root.get("action"), action.trim()));
        }
        if (from != null) {
            spec = spec.and((root, q, cb) -> cb.greaterThanOrEqualTo(root.get("createdAt"), Ist.startOfDay(from)));
        }
        if (to != null) {
            spec = spec.and((root, q, cb) -> cb.lessThan(root.get("createdAt"), Ist.startOfDay(to.plusDays(1))));
        }
        var p = repo.findAll(spec, PageRequest.of(page, size, Sort.by("createdAt", "id")));
        return PageView.of(p.map(e -> new AuditView(e.getId(), e.getEntityType(), e.getEntityId(), e.getClaimId(),
                e.getAction(), e.getActorId(), e.getOnBehalfOfId(), parse(e.getBefore()), parse(e.getAfter()),
                e.getRequestId(), Ist.render(e.getCreatedAt()))));
    }

    private JsonNode parse(String s) {
        return s == null ? null : json.readTree(s);
    }
}
