package com.expenseflow.policy.engine;

import com.expenseflow.policy.Outcome;
import com.expenseflow.policy.engine.PolicyModel.LineInput;
import com.expenseflow.policy.engine.PolicyModel.PolicyInput;
import com.expenseflow.policy.engine.PolicyModel.RuleDef;
import com.expenseflow.policy.engine.PolicyModel.RuleHit;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Pure policy engine (LLD §7). Every strategy runs on every line (no short-circuit) so the user sees
 * every reason; line outcome = worst hit, claim outcome = worst line (BR-11, BR-12).
 */
public class PolicyEngine {

    private final List<RuleStrategy> strategies;

    public PolicyEngine() {
        this(Strategies.ordered());
    }

    public PolicyEngine(List<RuleStrategy> strategies) {
        this.strategies = strategies;
    }

    public PolicyEvaluation evaluate(PolicyInput input, List<RuleDef> rules) {
        EvalContext ctx = new EvalContext(input);
        List<LineInput> ordered = input.lines().stream()
                .sorted(Comparator.comparing(LineInput::date).thenComparing(LineInput::lineId))
                .toList();

        List<RuleHit> hits = new ArrayList<>();
        Map<Long, Outcome> lineOutcomes = new LinkedHashMap<>();
        Outcome claimOutcome = Outcome.AUTO_APPROVE;

        for (LineInput line : ordered) {
            Outcome lineOutcome = Outcome.AUTO_APPROVE;
            for (RuleStrategy strategy : strategies) {
                for (RuleDef rule : applicable(rules, strategy.code(), line)) {
                    var hit = strategy.evaluate(line, rule, ctx);
                    if (hit.isPresent()) {
                        hits.add(hit.get());
                        lineOutcome = lineOutcome.worse(hit.get().outcome());
                    }
                }
            }
            lineOutcomes.put(line.lineId(), lineOutcome);
            claimOutcome = claimOutcome.worse(lineOutcome);
            ctx.markProcessed(line);
        }
        return new PolicyEvaluation(claimOutcome, lineOutcomes, hits);
    }

    /** Enabled rules with this code whose category / city tier match the line (null = any). */
    static List<RuleDef> applicable(List<RuleDef> rules, String code, LineInput line) {
        return rules.stream()
                .filter(RuleDef::enabled)
                .filter(r -> r.code().equals(code))
                .filter(r -> r.category() == null || r.category() == line.category())
                .filter(r -> r.cityTier() == null || r.cityTier() == line.cityTier())
                .toList();
    }
}
