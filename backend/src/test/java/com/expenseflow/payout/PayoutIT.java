package com.expenseflow.payout;

import com.expenseflow.support.IntegrationTest;
import com.expenseflow.user.Employee;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import tools.jackson.databind.JsonNode;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/** Payout lifecycle (Test Plan §7.4). */
class PayoutIT extends IntegrationTest {

    private List<Long> approvedClaims(int n) throws Exception {
        List<Long> ids = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            Employee e = emp("EMPLOYEE", null);
            ids.add(submittedClaim(e, (1000 + i) + ".50")); // auto-approved (≤ 5,000, no flags)
        }
        ids.forEach(id -> assertThat(status(id)).isEqualTo("APPROVED"));
        return ids;
    }

    @Test
    @DisplayName("TC-PAY-01 create batch from APPROVED → claims IN_PAYOUT, totals correct")
    void createBatch() throws Exception {
        List<Long> ids = approvedClaims(3);
        String fh = token(emp("EMPLOYEE,FINANCE_HEAD", null));
        JsonNode eligible = get("/api/payouts/eligible", fh, 200);
        assertThat(eligible.findValues("id").stream().map(JsonNode::asLong)).containsAll(ids);

        JsonNode b = post("/api/payouts", fh, Map.of("claimIds", ids), 201);
        assertThat(b.get("status").asText()).isEqualTo("CREATED");
        assertThat(b.get("claimCount").asInt()).isEqualTo(3);
        assertThat(b.get("totalAmount").decimalValue()).isEqualByComparingTo("3004.50");
        assertThat(b.get("batchNo").asText()).isEqualTo("B" + b.get("id").asLong());
        ids.forEach(id -> {
            assertThat(status(id)).isEqualTo("IN_PAYOUT");
            assertThat(auditCount(id, "PAYOUT_ITEM_ADDED")).isEqualTo(1);
        });
    }

    @Test
    @DisplayName("TC-PAY-02/03 export CSV (claims unchanged, re-export identical) then mark paid → PAID; "
            + "non-exported → 422")
    void exportAndPay() throws Exception {
        List<Long> ids = approvedClaims(2);
        String fh = token(emp("EMPLOYEE,FINANCE_HEAD", null));
        JsonNode b = post("/api/payouts", fh, Map.of("claimIds", ids), 201);
        long batch = b.get("id").asLong();
        post("/api/payouts/" + batch + "/mark-paid", fh, Map.of("version", b.get("version").asInt()), 422);

        var r1 = call(MockMvcRequestBuilders.get("/api/payouts/" + batch + "/csv"), fh, null, 200).getResponse();
        String csv = r1.getContentAsString(StandardCharsets.UTF_8);
        assertThat(r1.getHeader("Content-Disposition")).contains("EXPF_").contains("_" + batch + ".csv");
        String[] lines = csv.split("\n");
        assertThat(lines[0]).isEqualTo("H,BATCH_ID,DATE,COUNT,TOTAL");
        assertThat(lines[1]).startsWith("H," + batch + ",").endsWith(",2," + b.get("totalAmount").decimalValue().setScale(2).toPlainString());
        assertThat(lines[lines.length - 1]).isEqualTo("T,CONTROL_TOTAL," + b.get("totalAmount").decimalValue().setScale(2).toPlainString() + ",COUNT,2");
        ids.forEach(id -> assertThat(status(id)).isEqualTo("IN_PAYOUT"));

        byte[] again = call(MockMvcRequestBuilders.get("/api/payouts/" + batch + "/csv"), fh, null, 200)
                .getResponse().getContentAsByteArray();
        assertThat(again).isEqualTo(r1.getContentAsByteArray());

        JsonNode exported = get("/api/payouts/" + batch, fh, 200);
        assertThat(exported.get("status").asText()).isEqualTo("EXPORTED");
        assertThat(exported.get("fileSha256").asText()).hasSize(64);
        JsonNode paid = post("/api/payouts/" + batch + "/mark-paid", fh, Map.of("version", exported.get("version").asInt()), 200);
        assertThat(paid.get("status").asText()).isEqualTo("PAID");
        ids.forEach(id -> {
            assertThat(status(id)).isEqualTo("PAID");
            assertThat(auditCount(id, "CLAIM_PAID")).isEqualTo(1);
        });
    }

    @Test
    @DisplayName("TC-PAY-04 a claim cannot be in two batches → 409 (R14)")
    void twoBatches() throws Exception {
        List<Long> ids = approvedClaims(2);
        String fh = token(emp("EMPLOYEE,FINANCE_HEAD", null));
        post("/api/payouts", fh, Map.of("claimIds", List.of(ids.get(0))), 201);
        JsonNode err = post("/api/payouts", fh, Map.of("claimIds", ids), 409);
        assertThat(err.get("code").asText()).isEqualTo("ALREADY_BATCHED");
        assertThat(status(ids.get(1))).isEqualTo("APPROVED");
    }

    @Test
    @DisplayName("TC-PAY-06 void an unpaid batch → claims back to APPROVED and can be batched again; void on PAID → 422")
    void voidBatch() throws Exception {
        List<Long> ids = approvedClaims(2);
        String fh = token(emp("EMPLOYEE,FINANCE_HEAD", null));
        long batch = post("/api/payouts", fh, Map.of("claimIds", ids), 201).get("id").asLong();
        post("/api/payouts/" + batch + "/void", fh, Map.of("reason", ""), 422);
        JsonNode v = post("/api/payouts/" + batch + "/void", fh, Map.of("reason", "Wrong bank file"), 200);
        assertThat(v.get("status").asText()).isEqualTo("VOIDED");
        ids.forEach(id -> assertThat(status(id)).isEqualTo("APPROVED"));

        JsonNode again = post("/api/payouts", fh, Map.of("claimIds", ids), 201);
        long b2 = again.get("id").asLong();
        call(MockMvcRequestBuilders.get("/api/payouts/" + b2 + "/csv"), fh, null, 200);
        int ver = get("/api/payouts/" + b2, fh, 200).get("version").asInt();
        post("/api/payouts/" + b2 + "/mark-paid", fh, Map.of("version", ver), 200);
        post("/api/payouts/" + b2 + "/void", fh, Map.of("reason", "too late"), 422);
    }

    @Test
    @DisplayName("Payouts are finance-head only; non-approved claims cannot be batched")
    void guards() throws Exception {
        Employee mgr = emp("EMPLOYEE,MANAGER", null);
        long pending = submittedClaim(emp("EMPLOYEE", mgr), "9000.00");
        get("/api/payouts/eligible", token(emp("EMPLOYEE,AUDITOR", null)), 403);
        String fh = token(emp("EMPLOYEE,FINANCE_HEAD", null));
        assertThat(post("/api/payouts", fh, Map.of("claimIds", List.of(pending)), 422).get("code").asText())
                .isEqualTo("NOT_APPROVED");
    }
}
