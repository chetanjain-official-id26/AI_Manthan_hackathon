package com.expenseflow.claim;

import com.expenseflow.audit.AuditEntry;
import com.expenseflow.audit.AuditWriter;
import com.expenseflow.common.Kv;
import com.expenseflow.common.error.ApiException;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

import static com.expenseflow.claim.ClaimStatus.*;

/**
 * The only place a claim's status changes (CLAUDE.md rule 8). Each transition is checked against
 * LLD §2.1 and writes its audit row in the same transaction.
 */
@Component
public class ClaimStateMachine {

    private static final Map<ClaimStatus, Set<ClaimStatus>> ALLOWED = new EnumMap<>(ClaimStatus.class);

    static {
        ALLOWED.put(DRAFT, EnumSet.of(SUBMITTED));
        ALLOWED.put(SENT_BACK, EnumSet.of(SUBMITTED));
        ALLOWED.put(SUBMITTED, EnumSet.of(POLICY_REJECTED, APPROVED, PENDING_MANAGER, PENDING_AUDITOR));
        ALLOWED.put(PENDING_MANAGER, EnumSet.of(PENDING_AUDITOR, PENDING_FINANCE_HEAD, APPROVED, SENT_BACK, REJECTED));
        ALLOWED.put(PENDING_AUDITOR, EnumSet.of(PENDING_FINANCE_HEAD, APPROVED, SENT_BACK, REJECTED));
        ALLOWED.put(PENDING_FINANCE_HEAD, EnumSet.of(APPROVED, SENT_BACK, REJECTED));
        ALLOWED.put(APPROVED, EnumSet.of(IN_PAYOUT));
        ALLOWED.put(IN_PAYOUT, EnumSet.of(APPROVED, PAID));
        ALLOWED.put(POLICY_REJECTED, EnumSet.noneOf(ClaimStatus.class));
        ALLOWED.put(REJECTED, EnumSet.noneOf(ClaimStatus.class));
        ALLOWED.put(PAID, EnumSet.noneOf(ClaimStatus.class));
    }

    private final AuditWriter audit;
    private final Clock clock;

    public ClaimStateMachine(AuditWriter audit, Clock clock) {
        this.audit = audit;
        this.clock = clock;
    }

    public static boolean allowed(ClaimStatus from, ClaimStatus to) {
        return ALLOWED.getOrDefault(from, Set.of()).contains(to);
    }

    /** Creates a claim in DRAFT (T1). */
    @Transactional(propagation = Propagation.MANDATORY)
    public void initialise(Claim claim) {
        claim.setStatus(DRAFT);
        claim.setCreatedAt(clock.instant());
        claim.setUpdatedAt(clock.instant());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void transition(Claim claim, ClaimStatus to, String action, Long actorId, Long onBehalfOf,
                           Map<String, ?> extra) {
        ClaimStatus from = claim.getStatus();
        if (!allowed(from, to)) {
            throw ApiException.unprocessable("INVALID_STATE",
                    "Claim " + claim.getClaimNo() + " cannot move from " + from + " to " + to);
        }
        claim.setStatus(to);
        claim.setUpdatedAt(clock.instant());
        Map<String, Object> after = Kv.of("status", to.name(), "total", claim.getTotalAmount());
        if (extra != null) {
            after.putAll(extra);
        }
        audit.write(AuditEntry.claim(claim.getId(), action, actorId, onBehalfOf,
                Kv.of("status", from.name(), "version", claim.getVersion()), after));
    }

    /**
     * Audited event that does not change status (line edits, comments, policy evaluation). It does not
     * touch the claim row, so a comment never makes an approver's version stale.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void record(Claim claim, String action, Long actorId, Long onBehalfOf, Map<String, ?> before,
                       Map<String, ?> after) {
        audit.write(AuditEntry.claim(claim.getId(), action, actorId, onBehalfOf, before, after));
    }
}
