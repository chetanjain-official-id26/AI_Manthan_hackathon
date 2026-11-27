package com.expenseflow.policy;

import com.expenseflow.claim.Claim;
import com.expenseflow.claim.ClaimLine;
import com.expenseflow.claim.ClaimLineRepository;
import com.expenseflow.claim.ClaimStateMachine;
import com.expenseflow.claim.Receipt;
import com.expenseflow.claim.ReceiptRepository;
import com.expenseflow.common.Kv;
import com.expenseflow.common.time.Ist;
import com.expenseflow.policy.engine.PolicyEngine;
import com.expenseflow.policy.engine.PolicyEvaluation;
import com.expenseflow.policy.engine.PolicyModel.LineInput;
import com.expenseflow.policy.engine.PolicyModel.PolicyInput;
import com.expenseflow.policy.engine.PolicyModel.RuleDef;
import com.expenseflow.policy.engine.PolicyModel.RuleHit;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.json.JsonMapper;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Loads versioned rules, builds the engine input from the DB, and persists one policy_result row
 * per line per rule that fired (BR-14).
 */
@Service
public class PolicyService {

    private static final Duration CACHE_TTL = Duration.ofSeconds(30);

    private final PolicyRuleRepository ruleRepo;
    private final PolicyResultRepository resultRepo;
    private final ClaimLineRepository lineRepo;
    private final ReceiptRepository receiptRepo;
    private final ClaimStateMachine stateMachine;
    private final MeterRegistry meters;
    private final JsonMapper json;
    private final Clock clock;
    private final PolicyEngine engine = new PolicyEngine();

    private volatile CachedRules cache;

    private record CachedRules(List<PolicyRule> rows, Instant loadedAt) {
    }

    public PolicyService(PolicyRuleRepository ruleRepo, PolicyResultRepository resultRepo,
                         ClaimLineRepository lineRepo, ReceiptRepository receiptRepo,
                         ClaimStateMachine stateMachine, MeterRegistry meters, JsonMapper json, Clock clock) {
        this.ruleRepo = ruleRepo;
        this.resultRepo = resultRepo;
        this.lineRepo = lineRepo;
        this.receiptRepo = receiptRepo;
        this.stateMachine = stateMachine;
        this.meters = meters;
        this.json = json;
        this.clock = clock;
    }

    public void evictCache() {
        cache = null;
    }

    /** Per (code, category, tier) key: the highest version whose effective_from ≤ at (LLD §3.2). */
    public List<RuleDef> rulesAt(Instant at) {
        CachedRules c = cache;
        if (c == null || Duration.between(c.loadedAt(), Instant.now()).compareTo(CACHE_TTL) > 0) {
            c = new CachedRules(ruleRepo.findAll(), Instant.now());
            cache = c;
        }
        Map<String, PolicyRule> latest = new HashMap<>();
        for (PolicyRule r : c.rows()) {
            if (r.getEffectiveFrom().isAfter(at)) {
                continue;
            }
            String key = r.getRuleCode() + "|" + r.getCategory() + "|" + r.getCityTier();
            PolicyRule cur = latest.get(key);
            if (cur == null || r.getVersion() > cur.getVersion()) {
                latest.put(key, r);
            }
        }
        return latest.values().stream()
                .sorted(Comparator.comparing(PolicyRule::getId))
                .map(this::toDef)
                .toList();
    }

    RuleDef toDef(PolicyRule r) {
        Map<String, Object> params = r.getParams() == null || r.getParams().isBlank() ? Map.of()
                : json.readValue(r.getParams(), new TypeReference<Map<String, Object>>() {
        });
        return new RuleDef(r.getId(), r.getRuleCode(), r.getCategory(), r.getCityTier(), r.getLimitAmount(),
                r.getUnit(), r.getAction(), r.getFlag(), params, r.getVersion(), r.isEnabled());
    }

    /** Dry run used by the editor for inline feedback (EF-004). Nothing is persisted. */
    @Transactional(readOnly = true)
    public PolicyEvaluation preview(Claim claim) {
        Instant now = clock.instant();
        return engine.evaluate(buildInput(claim, now), rulesAt(now));
    }

    /** Runs the engine at submit (BR-02) and stores results under evaluation_no = claim.cycleNo. */
    @Transactional(propagation = Propagation.MANDATORY)
    public PolicyEvaluation evaluateAndPersist(Claim claim, Long actorId) {
        Instant now = clock.instant();
        PolicyEvaluation ev = engine.evaluate(buildInput(claim, now), rulesAt(now));

        List<PolicyResult> rows = new ArrayList<>();
        for (RuleHit h : ev.hits()) {
            PolicyResult pr = new PolicyResult();
            pr.setClaimLineId(h.lineId());
            pr.setRuleId(h.ruleId());
            pr.setRuleCode(h.ruleCode());
            pr.setRuleVersion(h.ruleVersion());
            pr.setOutcome(h.outcome());
            pr.setFlag(h.flag());
            pr.setReason(truncate(h.reason(), 300));
            pr.setRelatedLineId(h.relatedLineId());
            pr.setEvaluationNo(claim.getCycleNo());
            pr.setEvaluatedAt(now);
            rows.add(pr);
            meters.counter("expenseflow.policy.outcome", "outcome", h.outcome().name(), "rule", h.ruleCode())
                    .increment();
        }
        resultRepo.saveAll(rows);
        for (ClaimLine l : claim.getLines()) {
            l.setLineOutcome(ev.lineOutcome(l.getId()));
        }
        claim.setPolicyOutcome(ev.claimOutcome());
        stateMachine.record(claim, "POLICY_EVALUATED", null, null, null,
                Kv.of("outcome", ev.claimOutcome().name(), "evaluationNo", claim.getCycleNo(),
                        "rulesFired", ev.hits().stream().map(RuleHit::ruleCode).distinct().sorted().toList(),
                        "submittedBy", actorId));
        return ev;
    }

    PolicyInput buildInput(Claim claim, Instant now) {
        List<ClaimLine> lines = claim.getLines();
        List<Long> lineIds = lines.stream().map(ClaimLine::getId).filter(Objects::nonNull).toList();
        Map<Long, String> receiptByLine = lineIds.isEmpty() ? Map.of()
                : receiptRepo.findByClaimLineIdIn(lineIds).stream()
                .collect(Collectors.toMap(Receipt::getClaimLineId, Receipt::getSha256));

        List<LineInput> inputs = lines.stream()
                .map(l -> new LineInput(l.getId(), l.getCategory(), l.getAmount(), l.getExpenseDate(),
                        l.getVendorNorm(), l.getCityTier(), l.getNights(), receiptByLine.get(l.getId())))
                .toList();

        Set<LocalDate> dates = lines.stream().map(ClaimLine::getExpenseDate).collect(Collectors.toSet());
        Long claimId = claim.getId() == null ? -1L : claim.getId();
        var history = dates.isEmpty() ? List.<com.expenseflow.policy.engine.PolicyModel.HistoryLine>of()
                : lineRepo.findHistory(claim.getEmployeeId(), claimId, dates);
        Set<String> hashes = Set.copyOf(receiptByLine.values());
        var matches = hashes.isEmpty() ? List.<com.expenseflow.policy.engine.PolicyModel.ReceiptMatch>of()
                : receiptRepo.findMatches(hashes, claimId);

        return new PolicyInput(claim.getEmployeeId(), inputs, history, matches, Ist.date(now));
    }

    private static String truncate(String s, int max) {
        return s == null || s.length() <= max ? s : s.substring(0, max);
    }
}
