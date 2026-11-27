package com.expenseflow.approval;

import com.expenseflow.claim.ClaimStateMachine;
import com.expenseflow.claim.ClaimStatus;
import com.expenseflow.policy.ConfigService;
import com.expenseflow.user.DelegationService;
import com.expenseflow.user.DelegationService.Edge;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.math.BigDecimal;
import java.util.List;
import java.util.Random;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/** Pure unit tests: threshold planning, delegation cycles, sample rate, state machine table. */
class ApprovalUnitTest {

    static ApprovalThreshold t(String level, int seq, String min) {
        ApprovalThreshold t = new ApprovalThreshold();
        t.setLevel(level);
        t.setSeq(seq);
        t.setMinTotalExclusive(new BigDecimal(min));
        t.setRole(level);
        return t;
    }

    static final List<ApprovalThreshold> SEED = List.of(t("MANAGER", 1, "0.00"), t("AUDITOR", 2, "25000.00"),
            t("FINANCE_HEAD", 3, "100000.00"));

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource({
            "0.01,       MANAGER",
            "25000.00,   MANAGER",
            "25000.01,   MANAGER>AUDITOR",
            "100000.00,  MANAGER>AUDITOR",
            "100000.01,  MANAGER>AUDITOR>FINANCE_HEAD"
    })
    @DisplayName("BR-06..08 thresholds are strictly greater-than (25,000 / 1,00,000 boundaries)")
    void plan(String total, String expected) {
        assertThat(ApprovalChainFactory.plan(new BigDecimal(total), SEED).stream().map(ApprovalThreshold::getLevel)
                .toList()).containsExactly(expected.split(">"));
    }

    @Test
    @DisplayName("Thresholds come from config: a lower auditor threshold adds the auditor step")
    void planFromConfig() {
        var lowered = List.of(t("MANAGER", 1, "0.00"), t("AUDITOR", 2, "10000.00"), t("FINANCE_HEAD", 3, "100000.00"));
        assertThat(ApprovalChainFactory.plan(new BigDecimal("15000.00"), lowered)).hasSize(2);
    }

    @Test
    @DisplayName("R3 delegation cycle detection: A→B + B→A, A→B→C + C→A, but not A→B + C→A")
    void cycles() {
        assertThat(DelegationService.createsCycle(List.of(new Edge(1L, 2L)), 2L, 1L)).isTrue();
        assertThat(DelegationService.createsCycle(List.of(new Edge(1L, 2L), new Edge(2L, 3L)), 3L, 1L)).isTrue();
        assertThat(DelegationService.createsCycle(List.of(new Edge(1L, 2L)), 3L, 1L)).isFalse();
        assertThat(DelegationService.createsCycle(List.of(), 1L, 2L)).isFalse();
    }

    private static int picks(long seed, int draws, String rate) {
        SampleAuditSelector s = new SampleAuditSelector(new Random(seed), mock(ConfigService.class));
        int picked = 0;
        for (int i = 0; i < draws; i++) {
            if (s.pick(new BigDecimal(rate))) {
                picked++;
            }
        }
        return picked;
    }

    /**
     * TC-AUD-03. Note: for one seed, "100 ± 20 of 1,000" is only a ±2σ band (σ ≈ 9.5); java.util.Random(42)
     * happens to give 74. The rate is therefore asserted over 10,000 draws (σ ≈ 30), plus reproducibility.
     */
    @Test
    @DisplayName("TC-AUD-03 seeded sample audit picks ~10% (10,000 draws within 10% ± 1%) and is reproducible (BR-20)")
    void sampleRate() {
        int picked = picks(42, 10_000, "0.10");
        assertThat(picked).isBetween(900, 1100);
        assertThat(picks(42, 1000, "0.10")).as("same seed, same sample").isEqualTo(picks(42, 1000, "0.10"));
        assertThat(picks(42, 1000, "0.00")).isZero();
        assertThat(picks(42, 1000, "1.00")).isEqualTo(1000);
    }

    @Test
    @DisplayName("State machine follows LLD §2.1: terminal states are final; no skipping to PAID")
    void transitions() {
        assertThat(ClaimStateMachine.allowed(ClaimStatus.DRAFT, ClaimStatus.SUBMITTED)).isTrue();
        assertThat(ClaimStateMachine.allowed(ClaimStatus.DRAFT, ClaimStatus.APPROVED)).isFalse();
        assertThat(ClaimStateMachine.allowed(ClaimStatus.SENT_BACK, ClaimStatus.SUBMITTED)).isTrue();
        assertThat(ClaimStateMachine.allowed(ClaimStatus.APPROVED, ClaimStatus.PAID)).isFalse();
        assertThat(ClaimStateMachine.allowed(ClaimStatus.IN_PAYOUT, ClaimStatus.APPROVED)).isTrue();
        for (ClaimStatus to : ClaimStatus.values()) {
            assertThat(ClaimStateMachine.allowed(ClaimStatus.PAID, to)).isFalse();
            assertThat(ClaimStateMachine.allowed(ClaimStatus.REJECTED, to)).isFalse();
            assertThat(ClaimStateMachine.allowed(ClaimStatus.POLICY_REJECTED, to)).isFalse();
        }
    }
}
