package com.expenseflow.audit;

import java.util.Map;

/** One audit row to write. {@code before}/{@code after} become JSONB. */
public record AuditEntry(String entityType, Long entityId, Long claimId, String action,
                         Long actorId, Long onBehalfOfId, Map<String, ?> before, Map<String, ?> after) {

    public static final String CLAIM = "CLAIM";
    public static final String APPROVAL_STEP = "APPROVAL_STEP";
    public static final String POLICY_RULE = "POLICY_RULE";
    public static final String THRESHOLD = "APPROVAL_THRESHOLD";
    public static final String DELEGATION = "DELEGATION";
    public static final String PAYOUT_BATCH = "PAYOUT_BATCH";
    public static final String AUTH = "AUTH";

    public static AuditEntry claim(Long claimId, String action, Long actorId, Long onBehalfOf,
                                   Map<String, ?> before, Map<String, ?> after) {
        return new AuditEntry(CLAIM, claimId, claimId, action, actorId, onBehalfOf, before, after);
    }
}
