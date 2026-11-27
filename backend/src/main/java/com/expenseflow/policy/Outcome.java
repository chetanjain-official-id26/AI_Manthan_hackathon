package com.expenseflow.policy;

/** Declared in severity order: AUTO_REJECT &gt; ROUTE &gt; AUTO_APPROVE (BR-12). */
public enum Outcome {
    AUTO_APPROVE, ROUTE, AUTO_REJECT;

    public Outcome worse(Outcome other) {
        return other != null && other.ordinal() > ordinal() ? other : this;
    }
}
