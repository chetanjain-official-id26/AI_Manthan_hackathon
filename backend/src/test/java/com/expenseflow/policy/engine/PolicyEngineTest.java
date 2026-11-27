package com.expenseflow.policy.engine;

import com.expenseflow.claim.Category;
import com.expenseflow.claim.CityTier;
import com.expenseflow.policy.Outcome;
import com.expenseflow.policy.engine.PolicyModel.HistoryLine;
import com.expenseflow.policy.engine.PolicyModel.LineInput;
import com.expenseflow.policy.engine.PolicyModel.PolicyInput;
import com.expenseflow.policy.engine.PolicyModel.ReceiptMatch;
import com.expenseflow.policy.engine.PolicyModel.RuleDef;
import com.expenseflow.policy.engine.PolicyModel.RuleHit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Policy engine unit tests (Test Plan §7.1). Rules mirror V2__seed_config.sql; nothing here is a
 * limit baked into production code.
 */
class PolicyEngineTest {

    static final LocalDate TODAY = LocalDate.of(2026, 11, 27);      // Friday
    static final LocalDate WEDNESDAY = LocalDate.of(2026, 11, 25);
    static final LocalDate FRIDAY = LocalDate.of(2026, 11, 20);
    static final LocalDate SATURDAY = LocalDate.of(2026, 11, 21);
    static final LocalDate SUNDAY = LocalDate.of(2026, 11, 22);
    static final String HASH_A = "a".repeat(64);

    final PolicyEngine engine = new PolicyEngine();
    long nextId = 1;

    // ---------------------------------------------------------------- fixtures

    static List<RuleDef> seedRules() {
        List<RuleDef> r = new ArrayList<>();
        r.add(rule(1, "RECEIPT_REQUIRED", null, null, "500.00", "PER_LINE", Outcome.AUTO_REJECT, "RECEIPT", Map.of()));
        r.add(rule(2, "DUPLICATE_RECEIPT_HASH", null, null, null, "NONE", Outcome.ROUTE, "DUPLICATE", Map.of()));
        r.add(rule(3, "DUPLICATE_VENDOR_AMOUNT_DATE", null, null, null, "NONE", Outcome.ROUTE, "DUPLICATE", Map.of()));
        r.add(rule(4, "MEAL_DAILY_LIMIT", Category.MEAL, null, "1500.00", "PER_DAY", Outcome.ROUTE, "OVER_LIMIT", Map.of()));
        r.add(rule(5, "HOTEL_NIGHTLY_LIMIT", Category.HOTEL, CityTier.TIER_1, "6000.00", "PER_NIGHT", Outcome.ROUTE, "OVER_LIMIT", Map.of()));
        r.add(rule(6, "HOTEL_NIGHTLY_LIMIT", Category.HOTEL, CityTier.OTHER, "4000.00", "PER_NIGHT", Outcome.ROUTE, "OVER_LIMIT", Map.of()));
        r.add(rule(7, "CAB_TRIP_LIMIT", Category.CAB, null, "2000.00", "PER_TRIP", Outcome.ROUTE, "OVER_LIMIT", Map.of()));
        r.add(rule(8, "WEEKEND_SPEND", null, null, null, "NONE", Outcome.ROUTE, "WEEKEND",
                Map.of("weekendDays", List.of("SATURDAY", "SUNDAY"))));
        r.add(rule(9, "STALE_EXPENSE", null, null, null, "NONE", Outcome.ROUTE, "STALE", Map.of("maxAgeDays", 90)));
        return r;
    }

    static RuleDef rule(long id, String code, Category cat, CityTier tier, String limit, String unit, Outcome action,
                        String flag, Map<String, Object> params) {
        return new RuleDef(id, code, cat, tier, limit == null ? null : new BigDecimal(limit), unit, action, flag,
                params, 1, true);
    }

    LineInput line(Category cat, String amount, LocalDate date, String vendor, CityTier tier, Integer nights,
                   String receipt) {
        return new LineInput(nextId++, cat, new BigDecimal(amount), date, VendorNormalizer.normalize(vendor), tier,
                nights, receipt);
    }

    LineInput meal(String amount, LocalDate date) {
        return line(Category.MEAL, amount, date, "Cafe " + nextId, CityTier.OTHER, null, receipt());
    }

    String receipt() {
        return String.format("%064x", nextId * 7919);
    }

    PolicyEvaluation run(List<LineInput> lines) {
        return run(lines, List.of(), List.of(), seedRules());
    }

    PolicyEvaluation run(List<LineInput> lines, List<HistoryLine> history, List<ReceiptMatch> matches,
                         List<RuleDef> rules) {
        return engine.evaluate(new PolicyInput(42L, lines, history, matches, TODAY), rules);
    }

    // ---------------------------------------------------------------- meals

    @Nested
    class Meals {
        @Test
        @DisplayName("TC-POL-01 meal below limit 1,499.99 → AUTO_APPROVE")
        void below() {
            LineInput l = meal("1499.99", WEDNESDAY);
            PolicyEvaluation ev = run(List.of(l));
            assertThat(ev.lineOutcome(l.lineId())).isEqualTo(Outcome.AUTO_APPROVE);
            assertThat(ev.claimOutcome()).isEqualTo(Outcome.AUTO_APPROVE);
            assertThat(ev.hits()).isEmpty();
        }

        @Test
        @DisplayName("TC-POL-02 meal at limit 1,500.00 → AUTO_APPROVE")
        void at() {
            LineInput l = meal("1500.00", WEDNESDAY);
            assertThat(run(List.of(l)).lineOutcome(l.lineId())).isEqualTo(Outcome.AUTO_APPROVE);
        }

        @Test
        @DisplayName("TC-POL-03 meal above limit 1,500.01 → ROUTE OVER_LIMIT")
        void above() {
            LineInput l = meal("1500.01", WEDNESDAY);
            PolicyEvaluation ev = run(List.of(l));
            assertThat(ev.lineOutcome(l.lineId())).isEqualTo(Outcome.ROUTE);
            assertThat(ev.flagsFor(l.lineId())).containsExactly("OVER_LIMIT");
            assertThat(ev.hitsFor(l.lineId())).extracting(RuleHit::ruleCode).containsExactly("MEAL_DAILY_LIMIT");
        }

        @Test
        @DisplayName("TC-POL-04a two meals of 800 on the same day in one claim → 2nd line flagged")
        void summedInClaim() {
            LineInput first = meal("800.00", WEDNESDAY);
            LineInput second = meal("800.00", WEDNESDAY);
            PolicyEvaluation ev = run(List.of(first, second));
            assertThat(ev.lineOutcome(first.lineId())).isEqualTo(Outcome.AUTO_APPROVE);
            assertThat(ev.lineOutcome(second.lineId())).isEqualTo(Outcome.ROUTE);
            assertThat(ev.flagsFor(second.lineId())).containsExactly("OVER_LIMIT");
        }

        @Test
        @DisplayName("TC-POL-04b meal summed across claims: 800 earlier submitted + 800 now → ROUTE (R16)")
        void summedAcrossClaims() {
            HistoryLine earlier = new HistoryLine(900L, 90L, "CLM-2026-000090", Category.MEAL,
                    new BigDecimal("800.00"), WEDNESDAY, "some cafe");
            LineInput now = meal("800.00", WEDNESDAY);
            PolicyEvaluation ev = run(List.of(now), List.of(earlier), List.of(), seedRules());
            assertThat(ev.lineOutcome(now.lineId())).isEqualTo(Outcome.ROUTE);
            assertThat(ev.flagsFor(now.lineId())).contains("OVER_LIMIT");
        }

        @Test
        @DisplayName("Meals on different days are not summed")
        void differentDays() {
            LineInput a = meal("900.00", WEDNESDAY);
            LineInput b = meal("900.00", WEDNESDAY.minusDays(1));
            PolicyEvaluation ev = run(List.of(a, b));
            assertThat(ev.claimOutcome()).isEqualTo(Outcome.AUTO_APPROVE);
        }
    }

    // ---------------------------------------------------------------- hotels

    @Nested
    class Hotels {
        @ParameterizedTest(name = "{0}: {1} nights {2} in {3} → {4}")
        @CsvSource({
                "TC-POL-05, 1, 6000.00,  TIER_1, AUTO_APPROVE",
                "TC-POL-06, 1, 6000.01,  TIER_1, ROUTE",
                "TC-POL-07a, 1, 4000.00, OTHER,  AUTO_APPROVE",
                "TC-POL-07b, 1, 4000.01, OTHER,  ROUTE",
                "TC-POL-08a, 3, 18000.00, TIER_1, AUTO_APPROVE",
                "TC-POL-08b, 3, 18000.03, TIER_1, ROUTE",
                "EF-007 tier-1 2 nights, 2, 12000.00, TIER_1, AUTO_APPROVE",
                "EF-007 tier-1 2 nights above, 2, 12000.02, TIER_1, ROUTE",
                "Tier-1 limit does not apply to other cities, 1, 5000.00, OTHER, ROUTE",
                "Other-city limit does not apply to tier-1, 1, 5000.00, TIER_1, AUTO_APPROVE"
        })
        @DisplayName("TC-POL-05..08 hotel nightly limit by city tier")
        void nightly(String id, int nights, String amount, CityTier tier, Outcome expected) {
            LineInput l = line(Category.HOTEL, amount, WEDNESDAY, "Hotel " + id, tier, nights, receipt());
            PolicyEvaluation ev = run(List.of(l));
            assertThat(ev.lineOutcome(l.lineId())).as(id).isEqualTo(expected);
            if (expected == Outcome.ROUTE) {
                assertThat(ev.flagsFor(l.lineId())).containsExactly("OVER_LIMIT");
            }
        }
    }

    // ---------------------------------------------------------------- cabs and receipts

    @Test
    @DisplayName("TC-POL-09 cab at limit 2,000.00 → AUTO_APPROVE")
    void cabAt() {
        LineInput l = line(Category.CAB, "2000.00", WEDNESDAY, "Ola", CityTier.TIER_1, null, receipt());
        assertThat(run(List.of(l)).lineOutcome(l.lineId())).isEqualTo(Outcome.AUTO_APPROVE);
    }

    @Test
    @DisplayName("TC-POL-10 cab above 2,000.01 → ROUTE OVER_LIMIT")
    void cabAbove() {
        LineInput l = line(Category.CAB, "2000.01", WEDNESDAY, "Ola", CityTier.TIER_1, null, receipt());
        PolicyEvaluation ev = run(List.of(l));
        assertThat(ev.lineOutcome(l.lineId())).isEqualTo(Outcome.ROUTE);
        assertThat(ev.flagsFor(l.lineId())).containsExactly("OVER_LIMIT");
    }

    @Test
    @DisplayName("TC-POL-11 receipt not needed at exactly 500.00")
    void receiptAt500() {
        LineInput l = line(Category.OTHER, "500.00", WEDNESDAY, "Stationery", CityTier.OTHER, null, null);
        assertThat(run(List.of(l)).lineOutcome(l.lineId())).isEqualTo(Outcome.AUTO_APPROVE);
    }

    @Test
    @DisplayName("TC-POL-12 receipt required above 500 → AUTO_REJECT RECEIPT_REQUIRED")
    void receiptAbove500() {
        LineInput l = line(Category.OTHER, "500.01", WEDNESDAY, "Stationery", CityTier.OTHER, null, null);
        PolicyEvaluation ev = run(List.of(l));
        assertThat(ev.lineOutcome(l.lineId())).isEqualTo(Outcome.AUTO_REJECT);
        assertThat(ev.claimOutcome()).isEqualTo(Outcome.AUTO_REJECT);
        assertThat(ev.hitsFor(l.lineId())).singleElement()
                .satisfies(h -> {
                    assertThat(h.ruleCode()).isEqualTo("RECEIPT_REQUIRED");
                    assertThat(h.reason()).startsWith("RECEIPT_REQUIRED");
                });
    }

    @Test
    @DisplayName("A receipt above 500 satisfies RECEIPT_REQUIRED")
    void receiptPresent() {
        LineInput l = line(Category.OTHER, "500.01", WEDNESDAY, "Stationery", CityTier.OTHER, null, receipt());
        assertThat(run(List.of(l)).claimOutcome()).isEqualTo(Outcome.AUTO_APPROVE);
    }

    // ---------------------------------------------------------------- duplicates

    @Test
    @DisplayName("TC-POL-13 same receipt bytes used by another employee (renamed file) → ROUTE DUPLICATE")
    void duplicateHash() {
        LineInput l = line(Category.OTHER, "1200.00", WEDNESDAY, "Croma", CityTier.TIER_1, null, HASH_A);
        ReceiptMatch other = new ReceiptMatch(555L, 55L, "CLM-2026-000055", HASH_A);
        PolicyEvaluation ev = run(List.of(l), List.of(), List.of(other), seedRules());
        assertThat(ev.lineOutcome(l.lineId())).isEqualTo(Outcome.ROUTE);
        assertThat(ev.hitsFor(l.lineId())).singleElement().satisfies(h -> {
            assertThat(h.ruleCode()).isEqualTo("DUPLICATE_RECEIPT_HASH");
            assertThat(h.flag()).isEqualTo("DUPLICATE");
            assertThat(h.relatedLineId()).isEqualTo(555L);
        });
    }

    @Test
    @DisplayName("Duplicate receipt hash on two lines of the same claim → 2nd flagged")
    void duplicateHashInClaim() {
        LineInput a = line(Category.OTHER, "1200.00", WEDNESDAY, "Croma", CityTier.TIER_1, null, HASH_A);
        LineInput b = line(Category.OTHER, "1300.00", WEDNESDAY, "Reliance", CityTier.TIER_1, null, HASH_A);
        PolicyEvaluation ev = run(List.of(a, b));
        assertThat(ev.flagsFor(a.lineId())).isEmpty();
        assertThat(ev.flagsFor(b.lineId())).containsExactly("DUPLICATE");
    }

    @Test
    @DisplayName("TC-POL-14 duplicate vendor+amount+date with normalised vendor → ROUTE DUPLICATE")
    void duplicateVendor() {
        HistoryLine earlier = new HistoryLine(700L, 70L, "CLM-2026-000070", Category.HOTEL,
                new BigDecimal("4500.00"), LocalDate.of(2026, 11, 2), VendorNormalizer.normalize("Taj Hotel"));
        LineInput l = line(Category.HOTEL, "4500.00", LocalDate.of(2026, 11, 2), " taj  hotel.", CityTier.TIER_1, 1,
                receipt());
        PolicyEvaluation ev = run(List.of(l), List.of(earlier), List.of(), seedRules());
        assertThat(ev.lineOutcome(l.lineId())).isEqualTo(Outcome.ROUTE);
        assertThat(ev.hitsFor(l.lineId())).singleElement().satisfies(h -> {
            assertThat(h.ruleCode()).isEqualTo("DUPLICATE_VENDOR_AMOUNT_DATE");
            assertThat(h.relatedLineId()).isEqualTo(700L);
        });
    }

    @Test
    @DisplayName("TC-POL-15 not a duplicate when the amount differs (4,500 vs 4,500.50)")
    void notDuplicateDifferentAmount() {
        HistoryLine earlier = new HistoryLine(700L, 70L, "CLM-2026-000070", Category.HOTEL,
                new BigDecimal("4500.00"), LocalDate.of(2026, 11, 2), "taj hotel");
        LineInput l = line(Category.HOTEL, "4500.50", LocalDate.of(2026, 11, 2), "Taj Hotel", CityTier.TIER_1, 1,
                receipt());
        PolicyEvaluation ev = run(List.of(l), List.of(earlier), List.of(), seedRules());
        assertThat(ev.flagsFor(l.lineId())).doesNotContain("DUPLICATE");
    }

    @Test
    @DisplayName("Duplicate vendor+amount+date within one claim → only the later line is flagged")
    void duplicateVendorInClaim() {
        LineInput a = line(Category.CAB, "450.00", WEDNESDAY, "Uber", CityTier.TIER_1, null, null);
        LineInput b = line(Category.CAB, "450.00", WEDNESDAY, "UBER!", CityTier.TIER_1, null, null);
        PolicyEvaluation ev = run(List.of(a, b));
        assertThat(ev.flagsFor(a.lineId())).isEmpty();
        assertThat(ev.flagsFor(b.lineId())).containsExactly("DUPLICATE");
        assertThat(ev.hitsFor(b.lineId()).getFirst().relatedLineId()).isEqualTo(a.lineId());
    }

    @Test
    @DisplayName("Vendor normalisation: punctuation removed, spaces collapsed, lower-cased, trimmed")
    void normalise() {
        assertThat(VendorNormalizer.normalize(" Taj  Hotel. ")).isEqualTo("taj hotel");
        assertThat(VendorNormalizer.normalize("TAJ-HOTEL")).isEqualTo("tajhotel");
        assertThat(VendorNormalizer.normalize("Café, Coffee Day!")).isEqualTo("café coffee day");
    }

    // ---------------------------------------------------------------- dates

    @Test
    @DisplayName("TC-POL-16 expense older than 90 days → ROUTE STALE; exactly 90 days → no flag")
    void stale() {
        LineInput old = line(Category.OTHER, "100.00", TODAY.minusDays(91), "Old vendor", CityTier.OTHER, null, null);
        LineInput edge = line(Category.OTHER, "100.00", TODAY.minusDays(90), "Edge vendor", CityTier.OTHER, null, null);
        PolicyEvaluation ev = run(List.of(old, edge));
        assertThat(ev.flagsFor(old.lineId())).contains("STALE");
        assertThat(ev.flagsFor(edge.lineId())).doesNotContain("STALE");
    }

    @Test
    @DisplayName("TC-POL-18 weekend spend (Saturday and Sunday) → ROUTE WEEKEND")
    void weekend() {
        LineInput sat = line(Category.OTHER, "100.00", SATURDAY, "A", CityTier.OTHER, null, null);
        LineInput sun = line(Category.OTHER, "100.00", SUNDAY, "B", CityTier.OTHER, null, null);
        PolicyEvaluation ev = run(List.of(sat, sun));
        assertThat(ev.flagsFor(sat.lineId())).containsExactly("WEEKEND");
        assertThat(ev.flagsFor(sun.lineId())).containsExactly("WEEKEND");
        assertThat(ev.claimOutcome()).isEqualTo(Outcome.ROUTE);
    }

    @Test
    @DisplayName("TC-POL-19 weekday (Friday) is not flagged")
    void weekday() {
        LineInput fri = line(Category.OTHER, "100.00", FRIDAY, "A", CityTier.OTHER, null, null);
        assertThat(run(List.of(fri)).hits()).isEmpty();
    }

    // ---------------------------------------------------------------- aggregation and config

    @Test
    @DisplayName("TC-POL-20 worst line wins: approve + route + reject → claim AUTO_REJECT")
    void worstWins() {
        LineInput ok = meal("200.00", WEDNESDAY);
        LineInput route = line(Category.CAB, "2500.00", WEDNESDAY, "Ola", CityTier.TIER_1, null, receipt());
        LineInput reject = line(Category.OTHER, "900.00", WEDNESDAY, "Shop", CityTier.OTHER, null, null);
        PolicyEvaluation ev = run(List.of(ok, route, reject));
        assertThat(ev.lineOutcome(ok.lineId())).isEqualTo(Outcome.AUTO_APPROVE);
        assertThat(ev.lineOutcome(route.lineId())).isEqualTo(Outcome.ROUTE);
        assertThat(ev.lineOutcome(reject.lineId())).isEqualTo(Outcome.AUTO_REJECT);
        assertThat(ev.claimOutcome()).isEqualTo(Outcome.AUTO_REJECT);
    }

    @Test
    @DisplayName("EF-013 approve + route → claim ROUTE")
    void routeWins() {
        LineInput ok = meal("200.00", WEDNESDAY);
        LineInput route = line(Category.CAB, "2500.00", WEDNESDAY, "Ola", CityTier.TIER_1, null, receipt());
        assertThat(run(List.of(ok, route)).claimOutcome()).isEqualTo(Outcome.ROUTE);
    }

    @Test
    @DisplayName("All rules run with no short-circuit, so every reason is shown at once")
    void allReasons() {
        LineInput l = line(Category.MEAL, "1600.00", SATURDAY, "Dhaba", CityTier.OTHER, null, null);
        PolicyEvaluation ev = run(List.of(l));
        assertThat(ev.hitsFor(l.lineId())).extracting(RuleHit::ruleCode)
                .containsExactly("RECEIPT_REQUIRED", "MEAL_DAILY_LIMIT", "WEEKEND_SPEND");
        assertThat(ev.lineOutcome(l.lineId())).isEqualTo(Outcome.AUTO_REJECT);
    }

    @Test
    @DisplayName("TC-POL-21 meal limit v2 = 2,000 makes a 1,800 meal AUTO_APPROVE (no code change)")
    void configChange() {
        LineInput l = meal("1800.00", WEDNESDAY);
        assertThat(run(List.of(l)).lineOutcome(l.lineId())).isEqualTo(Outcome.ROUTE);

        List<RuleDef> v2 = new ArrayList<>(seedRules().stream().filter(r -> !r.code().equals("MEAL_DAILY_LIMIT")).toList());
        v2.add(new RuleDef(40L, "MEAL_DAILY_LIMIT", Category.MEAL, null, new BigDecimal("2000.00"), "PER_DAY",
                Outcome.ROUTE, "OVER_LIMIT", Map.of(), 2, true));
        PolicyEvaluation ev = run(List.of(l), List.of(), List.of(), v2);
        assertThat(ev.lineOutcome(l.lineId())).isEqualTo(Outcome.AUTO_APPROVE);
    }

    @Test
    @DisplayName("BR-13 changing a rule's action (cab → AUTO_REJECT) changes the outcome")
    void actionChange() {
        List<RuleDef> rules = new ArrayList<>(seedRules().stream().filter(r -> !r.code().equals("CAB_TRIP_LIMIT")).toList());
        rules.add(new RuleDef(41L, "CAB_TRIP_LIMIT", Category.CAB, null, new BigDecimal("2000.00"), "PER_TRIP",
                Outcome.AUTO_REJECT, "OVER_LIMIT", Map.of(), 2, true));
        LineInput l = line(Category.CAB, "2000.01", WEDNESDAY, "Ola", CityTier.TIER_1, null, receipt());
        PolicyEvaluation ev = run(List.of(l), List.of(), List.of(), rules);
        assertThat(ev.claimOutcome()).isEqualTo(Outcome.AUTO_REJECT);
        assertThat(ev.hitsFor(l.lineId()).getFirst().ruleVersion()).isEqualTo(2);
    }

    @Test
    @DisplayName("A disabled rule does not fire")
    void disabledRule() {
        List<RuleDef> rules = new ArrayList<>(seedRules().stream().filter(r -> !r.code().equals("WEEKEND_SPEND")).toList());
        rules.add(new RuleDef(42L, "WEEKEND_SPEND", null, null, null, "NONE", Outcome.ROUTE, "WEEKEND",
                Map.of("weekendDays", List.of("SATURDAY", "SUNDAY")), 2, false));
        LineInput sat = line(Category.OTHER, "100.00", SATURDAY, "A", CityTier.OTHER, null, null);
        assertThat(run(List.of(sat), List.of(), List.of(), rules).hits()).isEmpty();
    }

    @Test
    @DisplayName("Weekend days come from rule params, not code")
    void weekendParams() {
        List<RuleDef> rules = new ArrayList<>(seedRules().stream().filter(r -> !r.code().equals("WEEKEND_SPEND")).toList());
        rules.add(new RuleDef(43L, "WEEKEND_SPEND", null, null, null, "NONE", Outcome.ROUTE, "WEEKEND",
                Map.of("weekendDays", List.of("FRIDAY")), 2, true));
        LineInput fri = line(Category.OTHER, "100.00", FRIDAY, "A", CityTier.OTHER, null, null);
        LineInput sat = line(Category.OTHER, "100.00", SATURDAY, "B", CityTier.OTHER, null, null);
        PolicyEvaluation ev = run(List.of(fri, sat), List.of(), List.of(), rules);
        assertThat(ev.flagsFor(fri.lineId())).containsExactly("WEEKEND");
        assertThat(ev.flagsFor(sat.lineId())).isEmpty();
    }

    @Test
    @DisplayName("Final outcome does not depend on line order")
    void orderIndependent() {
        LineInput a = meal("900.00", WEDNESDAY);
        LineInput b = line(Category.OTHER, "700.00", WEDNESDAY, "X", CityTier.OTHER, null, null);
        assertThat(run(List.of(a, b)).claimOutcome()).isEqualTo(run(List.of(b, a)).claimOutcome());
    }
}
