package com.expenseflow.claim;

import java.util.EnumSet;
import java.util.Set;

public enum ClaimStatus {
    DRAFT, SUBMITTED, POLICY_REJECTED, PENDING_MANAGER, PENDING_AUDITOR, PENDING_FINANCE_HEAD, SENT_BACK,
    APPROVED, IN_PAYOUT, PAID, REJECTED;

    public static final Set<ClaimStatus> PENDING = EnumSet.of(PENDING_MANAGER, PENDING_AUDITOR, PENDING_FINANCE_HEAD);
    /** Claims "in flight" for R7: an editor with one of these may not change policy. */
    public static final Set<ClaimStatus> IN_FLIGHT = EnumSet.of(SUBMITTED, PENDING_MANAGER, PENDING_AUDITOR,
            PENDING_FINANCE_HEAD);

    public boolean editable() {
        return this == DRAFT || this == SENT_BACK;
    }

    public boolean pending() {
        return PENDING.contains(this);
    }

    public static ClaimStatus pendingFor(String level) {
        return valueOf("PENDING_" + level);
    }
}
