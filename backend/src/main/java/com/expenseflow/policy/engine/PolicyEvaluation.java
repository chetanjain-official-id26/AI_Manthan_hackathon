package com.expenseflow.policy.engine;

import com.expenseflow.policy.Outcome;
import com.expenseflow.policy.engine.PolicyModel.RuleHit;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/** Result of one evaluation: claim outcome = worst line outcome (BR-12). */
public record PolicyEvaluation(Outcome claimOutcome, Map<Long, Outcome> lineOutcomes, List<RuleHit> hits) {

    public List<RuleHit> hitsFor(Long lineId) {
        return hits.stream().filter(h -> h.lineId().equals(lineId)).toList();
    }

    public Set<String> flagsFor(Long lineId) {
        return hitsFor(lineId).stream().map(RuleHit::flag).filter(f -> f != null).collect(Collectors.toSet());
    }

    public Outcome lineOutcome(Long lineId) {
        return lineOutcomes.get(lineId);
    }
}
