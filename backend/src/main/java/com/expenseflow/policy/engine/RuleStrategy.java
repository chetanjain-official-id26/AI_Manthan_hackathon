package com.expenseflow.policy.engine;

import com.expenseflow.policy.engine.PolicyModel.LineInput;
import com.expenseflow.policy.engine.PolicyModel.RuleDef;
import com.expenseflow.policy.engine.PolicyModel.RuleHit;

import java.util.Optional;

/** One policy rule type. Limits and actions come from {@link RuleDef}, never from code. */
public interface RuleStrategy {

    String code();

    Optional<RuleHit> evaluate(LineInput line, RuleDef rule, EvalContext ctx);

    static RuleHit hit(LineInput line, RuleDef rule, String reason, Long relatedLineId) {
        return new RuleHit(line.lineId(), rule.id(), rule.code(), rule.version(), rule.action(), rule.flag(),
                reason, relatedLineId);
    }
}
