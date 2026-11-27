package com.expenseflow.common;

import com.expenseflow.claim.Category;
import com.expenseflow.claim.CityTier;
import com.expenseflow.claim.ReceiptStorage;
import com.expenseflow.common.error.ApiException;
import com.expenseflow.common.security.CurrentUser;
import com.expenseflow.common.security.Role;
import com.expenseflow.common.time.ClockConfig;
import com.expenseflow.common.time.Ist;
import com.expenseflow.common.time.MutableClock;
import com.expenseflow.common.web.RequestIdFilter;
import com.expenseflow.policy.Outcome;
import com.expenseflow.policy.engine.PolicyEngine;
import com.expenseflow.policy.engine.PolicyEvaluation;
import com.expenseflow.policy.engine.PolicyModel.LineInput;
import com.expenseflow.policy.engine.PolicyModel.PolicyInput;
import com.expenseflow.policy.engine.PolicyModel.ReceiptMatch;
import com.expenseflow.policy.engine.PolicyModel.RuleDef;
import com.expenseflow.policy.engine.VendorNormalizer;
import com.expenseflow.user.Delegation;
import com.expenseflow.user.DemoLoginRateLimiter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Edge and guard branches of pure helpers that the main suites do not reach. */
class EdgeCasesUnitTest {

    static final LocalDate WED = LocalDate.of(2026, 11, 25);

    @Nested
    class Storage {
        @Test
        @DisplayName("Empty upload → 422; over 5 MB → 413; unknown key → not found")
        void limits(@TempDir Path dir) {
            ReceiptStorage s = new ReceiptStorage(dir.toString());
            assertThatThrownBy(() -> s.store(new byte[0]))
                    .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.UNPROCESSABLE_CONTENT));
            byte[] big = new byte[(int) ReceiptStorage.MAX_BYTES + 1];
            big[0] = '%';
            big[1] = 'P';
            big[2] = 'D';
            big[3] = 'F';
            assertThatThrownBy(() -> s.store(big))
                    .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE));
            assertThatThrownBy(() -> s.store("GIF89a".getBytes()))
                    .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.UNSUPPORTED_MEDIA_TYPE));
            assertThatThrownBy(() -> s.load("00000000-0000-0000-0000-000000000000")).hasMessageContaining("not found");
        }

        @Test
        @DisplayName("Sniffing rejects truncated and near-miss signatures")
        void sniffEdges() {
            assertThat(ReceiptStorage.sniff(new byte[0])).isNull();
            assertThat(ReceiptStorage.sniff("%PD".getBytes())).isNull();
            assertThat(ReceiptStorage.sniff("%PDx".getBytes())).isNull();
            assertThat(ReceiptStorage.sniff(new byte[]{(byte) 0xFF, (byte) 0xD8})).isNull();
            assertThat(ReceiptStorage.sniff(new byte[]{(byte) 0xFF, (byte) 0xD9, (byte) 0xFF})).isNull();
            assertThat(ReceiptStorage.sniff(new byte[]{(byte) 0xFF, (byte) 0xD8, 0x00})).isNull();
            assertThat(ReceiptStorage.sniff(new byte[]{(byte) 0x89, 'P', 'N', 'G'})).isNull();
            assertThat(ReceiptStorage.sniff(new byte[]{(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0B})).isNull();
            assertThat(ReceiptStorage.sniff(new byte[]{(byte) 0x88, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A})).isNull();
            assertThat(ReceiptStorage.sniff(new byte[]{(byte) 0x89, 'X', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A})).isNull();
            assertThat(ReceiptStorage.sniff(new byte[]{(byte) 0x89, 'P', 'X', 'G', 0x0D, 0x0A, 0x1A, 0x0A})).isNull();
            assertThat(ReceiptStorage.sniff(new byte[]{(byte) 0x89, 'P', 'N', 'X', 0x0D, 0x0A, 0x1A, 0x0A})).isNull();
            assertThat(ReceiptStorage.sniff(new byte[]{(byte) 0x89, 'P', 'N', 'G', 0x0E, 0x0A, 0x1A, 0x0A})).isNull();
            assertThat(ReceiptStorage.sniff(new byte[]{(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0B, 0x1A, 0x0A})).isNull();
            assertThat(ReceiptStorage.sniff(new byte[]{(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1B, 0x0A})).isNull();
            assertThat(ReceiptStorage.sniff(new byte[]{'%', 'X', 'D', 'F'})).isNull();
            assertThat(ReceiptStorage.sniff(new byte[]{'%', 'P', 'X', 'F'})).isNull();
        }

        @Test
        @DisplayName("Long, blank and dot-only names are made safe")
        void names() {
            assertThat(ReceiptStorage.sanitizeName("a".repeat(150) + ".pdf")).hasSize(100).endsWith(".pdf");
            assertThat(ReceiptStorage.sanitizeName("   ")).isEqualTo("receipt");
            assertThat(ReceiptStorage.sanitizeName("../..")).isEqualTo("receipt");
            assertThat(ReceiptStorage.sanitizeName("dir/")).isEqualTo("receipt");
        }
    }

    @Nested
    class Strategies {
        final PolicyEngine engine = new PolicyEngine();

        RuleDef rule(String code, Category cat, CityTier tier, String limit, Map<String, Object> params, String flag) {
            return new RuleDef(1L, code, cat, tier, limit == null ? null : new BigDecimal(limit), "X", Outcome.ROUTE,
                    flag, params, 1, true);
        }

        LineInput line(long id, Category c, String amount, LocalDate d, Integer nights, String sha) {
            return new LineInput(id, c, new BigDecimal(amount), d, "v" + id, CityTier.OTHER, nights, sha);
        }

        PolicyEvaluation run(List<LineInput> lines, List<RuleDef> rules, List<ReceiptMatch> matches) {
            return engine.evaluate(new PolicyInput(1L, lines, List.of(), matches, WED.plusDays(2)), rules);
        }

        @Test
        @DisplayName("Rules without a limit or params never fire")
        void missingConfig() {
            List<RuleDef> rules = List.of(rule("RECEIPT_REQUIRED", null, null, null, Map.of(), "RECEIPT"),
                    rule("MEAL_DAILY_LIMIT", Category.MEAL, null, null, Map.of(), null),
                    rule("HOTEL_NIGHTLY_LIMIT", Category.HOTEL, null, null, Map.of(), null),
                    rule("CAB_TRIP_LIMIT", Category.CAB, null, null, Map.of(), null),
                    rule("WEEKEND_SPEND", null, null, null, null, "WEEKEND"),
                    rule("STALE_EXPENSE", null, null, null, null, "STALE"));
            LineInput sat = line(1, Category.MEAL, "99999.00", WED.minusDays(4), null, null); // Saturday, old-ish
            LineInput hotel = line(2, Category.HOTEL, "99999.00", WED, null, null);
            LineInput cab = line(3, Category.CAB, "99999.00", WED, null, null);
            assertThat(run(List.of(sat, hotel, cab), rules, List.of()).hits()).isEmpty();
        }

        @Test
        @DisplayName("Short weekend names (SAT), stale params as text are ignored, hotel nights default to 1")
        void paramShapes() {
            List<RuleDef> rules = List.of(
                    rule("WEEKEND_SPEND", null, null, null, Map.of("weekendDays", List.of("SAT")), "WEEKEND"),
                    rule("STALE_EXPENSE", null, null, null, Map.of("maxAgeDays", "ninety"), "STALE"),
                    rule("HOTEL_NIGHTLY_LIMIT", Category.HOTEL, CityTier.OTHER, "4000.00", Map.of(), "OVER_LIMIT"),
                    rule("WEEKEND_SPEND", null, null, null, Map.of("weekendDays", "SATURDAY"), "WEEKEND"));
            LineInput sat = line(1, Category.OTHER, "10.00", WED.minusDays(4), null, null);
            LineInput hotel = line(2, Category.HOTEL, "4000.01", WED, null, null);
            LineInput hotelZero = line(3, Category.HOTEL, "100.00", WED, 0, null);
            PolicyEvaluation ev = run(List.of(sat, hotel, hotelZero), rules, List.of());
            assertThat(ev.flagsFor(1L)).containsExactly("WEEKEND");
            assertThat(ev.flagsFor(2L)).containsExactly("OVER_LIMIT");
            assertThat(ev.flagsFor(3L)).isEmpty();
        }

        @Test
        @DisplayName("Receipt hash: a match on the same line is not a duplicate; non-matching hashes are ignored")
        void hashSelfMatch() {
            RuleDef r = rule("DUPLICATE_RECEIPT_HASH", null, null, null, Map.of(), "DUPLICATE");
            String sha = "b".repeat(64);
            LineInput l = line(7, Category.OTHER, "10.00", WED, null, sha);
            LineInput other = line(8, Category.OTHER, "10.00", WED, null, "c".repeat(64));
            List<ReceiptMatch> matches = List.of(new ReceiptMatch(7L, 1L, "C1", sha),
                    new ReceiptMatch(9L, 2L, "C2", "d".repeat(64)));
            assertThat(run(List.of(l, other), List.of(r), matches).hits()).isEmpty();
        }

        @Test
        @DisplayName("Duplicate vendor needs vendor, amount and date to all match")
        void vendorPartialMatch() {
            RuleDef r = rule("DUPLICATE_VENDOR_AMOUNT_DATE", null, null, null, Map.of(), "DUPLICATE");
            LineInput a = new LineInput(1L, Category.CAB, new BigDecimal("100.00"), WED, "uber", CityTier.OTHER, null, null);
            LineInput sameVendorOtherDay = new LineInput(2L, Category.CAB, new BigDecimal("100.00"), WED.minusDays(1), "uber", CityTier.OTHER, null, null);
            LineInput otherVendor = new LineInput(3L, Category.CAB, new BigDecimal("100.00"), WED, "ola", CityTier.OTHER, null, null);
            var hist = List.of(new com.expenseflow.policy.engine.PolicyModel.HistoryLine(9L, 9L, "C9", Category.CAB,
                    new BigDecimal("100.00"), WED.minusDays(5), "uber"));
            PolicyEvaluation ev = engine.evaluate(new PolicyInput(1L, List.of(a, sameVendorOtherDay, otherVendor), hist,
                    List.of(), WED), List.of(r));
            assertThat(ev.hits()).isEmpty();
        }

        @Test
        @DisplayName("Meals on other days or other categories are not summed")
        void mealSumFilters() {
            RuleDef r = rule("MEAL_DAILY_LIMIT", Category.MEAL, null, "1000.00", Map.of(), "OVER_LIMIT");
            var hist = List.of(
                    new com.expenseflow.policy.engine.PolicyModel.HistoryLine(9L, 9L, "C9", Category.CAB, new BigDecimal("900.00"), WED, "x"),
                    new com.expenseflow.policy.engine.PolicyModel.HistoryLine(8L, 8L, "C8", Category.MEAL, new BigDecimal("900.00"), WED.minusDays(1), "y"));
            LineInput cab = new LineInput(1L, Category.CAB, new BigDecimal("900.00"), WED, "z", CityTier.OTHER, null, null);
            LineInput meal = new LineInput(2L, Category.MEAL, new BigDecimal("900.00"), WED, "m", CityTier.OTHER, null, null);
            PolicyEvaluation ev = engine.evaluate(new PolicyInput(1L, List.of(cab, meal), hist, List.of(), WED), List.of(r));
            assertThat(ev.hits()).isEmpty();
        }

        @Test
        @DisplayName("Vendor normaliser handles null; flags of rules without a flag are skipped")
        void misc() {
            assertThat(VendorNormalizer.normalize(null)).isEmpty();
            RuleDef noFlag = rule("CAB_TRIP_LIMIT", Category.CAB, null, "10.00", Map.of(), null);
            PolicyEvaluation ev = run(List.of(line(1, Category.CAB, "11.00", WED, null, null)), List.of(noFlag), List.of());
            assertThat(ev.hits()).hasSize(1);
            assertThat(ev.flagsFor(1L)).isEmpty();
        }
    }

    @Nested
    class Helpers {
        @Test
        @DisplayName("Outcome.worse keeps the more severe outcome and tolerates null")
        void outcome() {
            assertThat(Outcome.ROUTE.worse(null)).isEqualTo(Outcome.ROUTE);
            assertThat(Outcome.AUTO_REJECT.worse(Outcome.ROUTE)).isEqualTo(Outcome.AUTO_REJECT);
            assertThat(Outcome.AUTO_APPROVE.worse(Outcome.ROUTE)).isEqualTo(Outcome.ROUTE);
        }

        @Test
        @DisplayName("Role parsing: blank → EMPLOYEE; EMPLOYEE is always added; format is sorted")
        void roles() {
            assertThat(Role.parse(null)).containsExactly(Role.EMPLOYEE);
            assertThat(Role.parse(" ")).containsExactly(Role.EMPLOYEE);
            assertThat(Role.parse("AUDITOR, ,MANAGER")).containsExactlyInAnyOrder(Role.EMPLOYEE, Role.AUDITOR, Role.MANAGER);
            assertThat(Role.format(Role.parse("MANAGER"))).isEqualTo("EMPLOYEE,MANAGER");
        }

        @Test
        @DisplayName("Kv rejects odd arguments and allows null values; Money.scale tolerates null")
        void kvMoney() {
            assertThatThrownBy(() -> Kv.of("a")).isInstanceOf(IllegalArgumentException.class);
            assertThat(Kv.of("a", null)).containsEntry("a", null);
            assertThat(Money.scale(null)).isNull();
            assertThat(Money.scale(new BigDecimal("1.005"))).isEqualByComparingTo("1.01");
        }

        @Test
        @DisplayName("MutableClock: pin, advance, reset, other zone; IST helpers")
        void clock() {
            MutableClock c = new MutableClock(Ist.ZONE);
            c.advance(Duration.ofHours(1));
            assertThat(c.instant()).isAfter(Instant.now().plus(Duration.ofMinutes(59)));
            Instant t = Instant.parse("2026-11-27T00:00:00Z");
            c.set(t);
            c.advance(Duration.ofMinutes(5));
            assertThat(c.instant()).isEqualTo(t.plus(Duration.ofMinutes(5)));
            assertThat(c.withZone(ZoneOffset.UTC).instant()).isEqualTo(c.instant());
            assertThat(c.withZone(ZoneOffset.UTC).getZone()).isEqualTo(ZoneOffset.UTC);
            c.reset();
            assertThat(c.instant()).isBefore(Instant.now().plusSeconds(1));
            assertThat(Ist.render(null)).isNull();
            assertThat(Ist.render(t).getOffset().getTotalSeconds()).isEqualTo(19800);
        }

        @Test
        @DisplayName("Sample-audit random: SecureRandom without a seed, seeded Random otherwise")
        void sampleRandom() {
            ClockConfig cfg = new ClockConfig();
            assertThat(cfg.sampleAuditRandom("")).isInstanceOf(SecureRandom.class);
            assertThat(cfg.sampleAuditRandom(null)).isInstanceOf(SecureRandom.class);
            Random r = cfg.sampleAuditRandom(" 42 ");
            assertThat(r.nextInt()).isEqualTo(new Random(42).nextInt());
        }

        @Test
        @DisplayName("Delegation.activeOn: inside, before, after and revoked")
        void delegation() {
            Delegation d = new Delegation();
            d.setFromDate(WED);
            d.setToDate(WED.plusDays(2));
            assertThat(d.activeOn(WED.plusDays(1))).isTrue();
            assertThat(d.activeOn(WED.minusDays(1))).isFalse();
            assertThat(d.activeOn(WED.plusDays(3))).isFalse();
            d.setRevoked(true);
            assertThat(d.activeOn(WED)).isFalse();
        }

        @Test
        @DisplayName("Rate limiter frees the window after a minute and keys by IP")
        void limiter() {
            DemoLoginRateLimiter l = new DemoLoginRateLimiter(1);
            assertThat(l.tryAcquire("a")).isTrue();
            assertThat(l.tryAcquire("a")).isFalse();
            assertThat(l.tryAcquire("b")).isTrue();
            l.reset();
            assertThat(l.tryAcquire("a")).isTrue();
        }

        @Test
        @DisplayName("Request id: a safe client id is echoed, an unsafe one is replaced")
        void requestId() throws Exception {
            RequestIdFilter f = new RequestIdFilter();
            MockHttpServletRequest req = new MockHttpServletRequest();
            req.addHeader(RequestIdFilter.HEADER, "abc-123");
            MockHttpServletResponse res = new MockHttpServletResponse();
            f.doFilter(req, res, new MockFilterChain());
            assertThat(res.getHeader(RequestIdFilter.HEADER)).isEqualTo("abc-123");

            MockHttpServletRequest bad = new MockHttpServletRequest();
            bad.addHeader(RequestIdFilter.HEADER, "<script>");
            MockHttpServletResponse res2 = new MockHttpServletResponse();
            f.doFilter(bad, res2, new MockFilterChain());
            assertThat(res2.getHeader(RequestIdFilter.HEADER)).hasSize(36);
        }

        @Test
        @DisplayName("CurrentUser.get without a JWT fails; claims without roles give an empty role set")
        void currentUser() {
            SecurityContextHolder.clearContext();
            assertThatThrownBy(CurrentUser::get).isInstanceOf(IllegalStateException.class);
            var jwt = org.springframework.security.oauth2.jwt.Jwt.withTokenValue("t").header("alg", "HS256")
                    .subject("5").claim("name", "Five").build();
            assertThat(CurrentUser.fromJwt(jwt).roles()).isEmpty();
            assertThat(new CurrentUser(1L, "x", java.util.Set.of(Role.FINANCE_HEAD)).seesAll()).isTrue();
        }

        @Test
        @DisplayName("ApiException helpers carry status and code")
        void apiException() {
            assertThat(ApiException.conflict("C", "m").getStatus()).isEqualTo(HttpStatus.CONFLICT);
            assertThat(ApiException.badRequest("B", "m").getCode()).isEqualTo("B");
            Map<String, String> errors = new HashMap<>();
            errors.put("f", "bad");
            assertThat(ApiException.fields(errors).getFieldErrors()).containsEntry("f", "bad");
        }
    }
}
