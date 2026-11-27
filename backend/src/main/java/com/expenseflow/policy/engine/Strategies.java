package com.expenseflow.policy.engine;

import com.expenseflow.claim.Category;
import com.expenseflow.common.Money;
import com.expenseflow.policy.engine.PolicyModel.HistoryLine;
import com.expenseflow.policy.engine.PolicyModel.LineInput;
import com.expenseflow.policy.engine.PolicyModel.ReceiptMatch;
import com.expenseflow.policy.engine.PolicyModel.RuleDef;
import com.expenseflow.policy.engine.PolicyModel.RuleHit;

import java.math.BigDecimal;
import java.time.DayOfWeek;
import java.time.temporal.ChronoUnit;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

import static com.expenseflow.policy.engine.RuleStrategy.hit;

/**
 * The rule strategies, in the order of LLD §7. Order only affects the order of explanations; the
 * worst outcome always wins. Comparisons use BigDecimal.compareTo (1500.00 passes, 1500.01 fails).
 */
public final class Strategies {
    private Strategies() {
    }

    public static List<RuleStrategy> ordered() {
        return List.of(new ReceiptRequired(), new DuplicateReceiptHash(), new DuplicateVendorAmountDate(),
                new MealDailyLimit(), new HotelNightlyLimit(), new CabTripLimit(), new WeekendSpend(),
                new StaleExpense());
    }

    /** 1. amount &gt; limit and no receipt. */
    static final class ReceiptRequired implements RuleStrategy {
        public String code() {
            return "RECEIPT_REQUIRED";
        }

        public Optional<RuleHit> evaluate(LineInput line, RuleDef rule, EvalContext ctx) {
            if (rule.limit() == null || line.receiptSha256() != null || !Money.gt(line.amount(), rule.limit())) {
                return Optional.empty();
            }
            return Optional.of(hit(line, rule, "RECEIPT_REQUIRED: receipt is mandatory above "
                    + Money.plain(rule.limit()), null));
        }
    }

    /** 2. Same receipt bytes as another line (any employee, or an earlier line of this claim). */
    static final class DuplicateReceiptHash implements RuleStrategy {
        public String code() {
            return "DUPLICATE_RECEIPT_HASH";
        }

        public Optional<RuleHit> evaluate(LineInput line, RuleDef rule, EvalContext ctx) {
            String sha = line.receiptSha256();
            if (sha == null) {
                return Optional.empty();
            }
            for (ReceiptMatch m : ctx.input().receiptMatches()) {
                if (sha.equals(m.sha256()) && !m.lineId().equals(line.lineId())) {
                    return Optional.of(hit(line, rule, "DUPLICATE: same receipt file as claim " + m.claimNo(),
                            m.lineId()));
                }
            }
            for (LineInput earlier : ctx.earlierLines()) {
                if (sha.equals(earlier.receiptSha256())) {
                    return Optional.of(hit(line, rule, "DUPLICATE: same receipt file as another line in this claim",
                            earlier.lineId()));
                }
            }
            return Optional.empty();
        }
    }

    /** 3. Same employee + normalised vendor + amount + date as an earlier line. */
    static final class DuplicateVendorAmountDate implements RuleStrategy {
        public String code() {
            return "DUPLICATE_VENDOR_AMOUNT_DATE";
        }

        public Optional<RuleHit> evaluate(LineInput line, RuleDef rule, EvalContext ctx) {
            for (HistoryLine h : ctx.input().history()) {
                if (h.vendorNorm().equals(line.vendorNorm()) && h.amount().compareTo(line.amount()) == 0
                        && h.date().equals(line.date())) {
                    return Optional.of(hit(line, rule, "DUPLICATE: same vendor, amount and date as claim "
                            + h.claimNo(), h.lineId()));
                }
            }
            for (LineInput e : ctx.earlierLines()) {
                if (e.vendorNorm().equals(line.vendorNorm()) && e.amount().compareTo(line.amount()) == 0
                        && e.date().equals(line.date())) {
                    return Optional.of(hit(line, rule,
                            "DUPLICATE: same vendor, amount and date as another line in this claim", e.lineId()));
                }
            }
            return Optional.empty();
        }
    }

    /** 4. Meals per employee per calendar day, summed across this and other non-draft claims (R16). */
    static final class MealDailyLimit implements RuleStrategy {
        public String code() {
            return "MEAL_DAILY_LIMIT";
        }

        public Optional<RuleHit> evaluate(LineInput line, RuleDef rule, EvalContext ctx) {
            if (line.category() != Category.MEAL || rule.limit() == null) {
                return Optional.empty();
            }
            BigDecimal sum = line.amount()
                    .add(sumMeals(ctx.input().history().stream()
                            .filter(h -> h.category() == Category.MEAL && h.date().equals(line.date()))
                            .map(HistoryLine::amount).toList()))
                    .add(sumMeals(ctx.earlierLines().stream()
                            .filter(e -> e.category() == Category.MEAL && e.date().equals(line.date()))
                            .map(LineInput::amount).toList()));
            if (!Money.gt(sum, rule.limit())) {
                return Optional.empty();
            }
            return Optional.of(hit(line, rule, "OVER_LIMIT: meals on " + line.date() + " total " + Money.plain(sum)
                    + ", above the daily limit of " + Money.plain(rule.limit()), null));
        }

        private static BigDecimal sumMeals(Collection<BigDecimal> amounts) {
            return amounts.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        }
    }

    /** 5. Hotel per night by city tier: amount &gt; limit × nights (no rounding from division). */
    static final class HotelNightlyLimit implements RuleStrategy {
        public String code() {
            return "HOTEL_NIGHTLY_LIMIT";
        }

        public Optional<RuleHit> evaluate(LineInput line, RuleDef rule, EvalContext ctx) {
            if (line.category() != Category.HOTEL || rule.limit() == null) {
                return Optional.empty();
            }
            int nights = line.nights() == null || line.nights() < 1 ? 1 : line.nights();
            BigDecimal cap = rule.limit().multiply(BigDecimal.valueOf(nights));
            if (!Money.gt(line.amount(), cap)) {
                return Optional.empty();
            }
            BigDecimal perNight = line.amount().divide(BigDecimal.valueOf(nights), 2, java.math.RoundingMode.HALF_UP);
            return Optional.of(hit(line, rule, "OVER_LIMIT: hotel " + Money.plain(perNight) + " per night over "
                    + nights + " night(s), above the " + line.cityTier() + " limit of " + Money.plain(rule.limit()),
                    null));
        }
    }

    /** 6. Local cab per trip. */
    static final class CabTripLimit implements RuleStrategy {
        public String code() {
            return "CAB_TRIP_LIMIT";
        }

        public Optional<RuleHit> evaluate(LineInput line, RuleDef rule, EvalContext ctx) {
            if (line.category() != Category.CAB || rule.limit() == null || !Money.gt(line.amount(), rule.limit())) {
                return Optional.empty();
            }
            return Optional.of(hit(line, rule, "OVER_LIMIT: cab trip " + Money.plain(line.amount())
                    + " is above the per-trip limit of " + Money.plain(rule.limit()), null));
        }
    }

    /** 7. Expense date on a configured weekend day (dates are IST calendar dates). */
    static final class WeekendSpend implements RuleStrategy {
        public String code() {
            return "WEEKEND_SPEND";
        }

        public Optional<RuleHit> evaluate(LineInput line, RuleDef rule, EvalContext ctx) {
            Object days = rule.params() == null ? null : rule.params().get("weekendDays");
            if (!(days instanceof Collection<?> list)) {
                return Optional.empty();
            }
            DayOfWeek dow = line.date().getDayOfWeek();
            boolean weekend = list.stream().anyMatch(d -> dow.name().equalsIgnoreCase(String.valueOf(d))
                    || dow.name().substring(0, 3).equalsIgnoreCase(String.valueOf(d)));
            return weekend ? Optional.of(hit(line, rule, "WEEKEND: expense date " + line.date() + " is a "
                    + dow.name().charAt(0) + dow.name().substring(1).toLowerCase(), null)) : Optional.empty();
        }
    }

    /** 8. Expense older than params.maxAgeDays at submit time (R6). */
    static final class StaleExpense implements RuleStrategy {
        public String code() {
            return "STALE_EXPENSE";
        }

        public Optional<RuleHit> evaluate(LineInput line, RuleDef rule, EvalContext ctx) {
            Object max = rule.params() == null ? null : rule.params().get("maxAgeDays");
            if (!(max instanceof Number n)) {
                return Optional.empty();
            }
            long age = ChronoUnit.DAYS.between(line.date(), ctx.input().today());
            return age > n.longValue()
                    ? Optional.of(hit(line, rule, "STALE: expense is " + age + " days old (limit " + n.longValue()
                    + " days)", null))
                    : Optional.empty();
        }
    }
}
