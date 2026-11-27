package com.expenseflow.claim;

import com.expenseflow.common.security.Role;
import com.expenseflow.support.IntegrationTest;
import com.expenseflow.user.Employee;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import tools.jackson.databind.JsonNode;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Claims API (Test Plan §7.6) plus the claim-related security cases (§7.7). */
class ClaimApiIT extends IntegrationTest {

    @Test
    @DisplayName("TC-CLM-01 create draft → DRAFT with audit CLAIM_CREATED; listed under my claims")
    void createDraft() throws Exception {
        Employee e = emp("EMPLOYEE", null);
        long id = createClaim(token(e), "Pune visit");
        assertThat(status(id)).isEqualTo("DRAFT");
        assertThat(auditCount(id, "CLAIM_CREATED")).isEqualTo(1);
        JsonNode list = get("/api/claims?mine=true", token(e), 200);
        assertThat(list.get("totalElements").asLong()).isEqualTo(1);
        assertThat(list.at("/content/0/claimNo").asText()).startsWith("CLM-");
    }

    @Test
    @DisplayName("TC-CLM-02 add / edit / remove lines keeps total = Σ lines, each change audited")
    void linesUpdateTotal() throws Exception {
        Employee e = emp("EMPLOYEE", null);
        String t = token(e);
        long id = createClaim(t, "Lines");
        long l1 = addLine(id, t, line(Category.MEAL, "300.00", weekday(), "Cafe", CityTier.OTHER, null));
        addLine(id, t, line(Category.CAB, "450.50", weekday(), "Ola", CityTier.TIER_1, null));
        assertThat(get("/api/claims/" + id, t, 200).at("/claim/totalAmount").decimalValue()).isEqualByComparingTo("750.50");

        put("/api/claims/" + id + "/lines/" + l1, t, line(Category.MEAL, "200.00", weekday(), "Cafe", CityTier.OTHER, null), 200);
        assertThat(get("/api/claims/" + id, t, 200).at("/claim/totalAmount").decimalValue()).isEqualByComparingTo("650.50");

        call(MockMvcRequestBuilders.delete("/api/claims/" + id + "/lines/" + l1), t, null, 204);
        JsonNode d = get("/api/claims/" + id, t, 200);
        assertThat(d.at("/claim/totalAmount").decimalValue()).isEqualByComparingTo("450.50");
        assertThat(d.get("lines")).hasSize(1);
        assertThat(auditCount(id, "LINE_ADDED")).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM audit_event WHERE claim_id = ? AND action = 'LINE_ADDED' "
                + "AND after->>'lineId' IS NULL", Long.class, id)).as("audit rows carry the new line id").isZero();
        assertThat(auditCount(id, "LINE_UPDATED")).isEqualTo(1);
        assertThat(auditCount(id, "LINE_REMOVED")).isEqualTo(1);
    }

    @Test
    @DisplayName("TC-CLM-03 validation: amount ≤ 0, future date, hotel without nights → 422 with field errors")
    void validation() throws Exception {
        String t = token(emp("EMPLOYEE", null));
        long id = createClaim(t, "Bad lines");
        JsonNode zero = post("/api/claims/" + id + "/lines", t,
                line(Category.MEAL, "0.00", weekday(), "Cafe", CityTier.OTHER, null), 422);
        assertThat(zero.at("/errors/amount").asText()).isNotBlank();

        JsonNode future = post("/api/claims/" + id + "/lines", t,
                line(Category.MEAL, "100.00", today().plusDays(1), "Cafe", CityTier.OTHER, null), 422);
        assertThat(future.at("/errors/expenseDate").asText()).contains("future");

        JsonNode hotel = post("/api/claims/" + id + "/lines", t,
                line(Category.HOTEL, "3000.00", weekday(), "Taj", CityTier.TIER_1, null), 422);
        assertThat(hotel.at("/errors/nights").asText()).isNotBlank();

        JsonNode threeDecimals = post("/api/claims/" + id + "/lines", t,
                line(Category.MEAL, "10.005", weekday(), "Cafe", CityTier.OTHER, null), 422);
        assertThat(threeDecimals.at("/errors/amount").asText()).isNotBlank();
    }

    @Test
    @DisplayName("TC-CLM-04 receipt upload stores SHA-256 of the raw bytes")
    void receiptHash() throws Exception {
        Employee e = emp("EMPLOYEE", null);
        String t = token(e);
        long id = createClaim(t, "Receipt");
        long line = addLine(id, t, line(Category.OTHER, "900.00", weekday(), "Croma", CityTier.TIER_1, null));
        byte[] bytes = png();
        JsonNode r = upload(id, line, t, bytes, "bill.png", 201);
        assertThat(r.get("sha256").asText()).isEqualTo(ReceiptStorage.sha256(bytes));
        assertThat(r.get("contentType").asText()).isEqualTo("image/png");

        byte[] back = call(MockMvcRequestBuilders.get("/api/receipts/" + r.get("receiptId").asLong()), t, null, 200)
                .getResponse().getContentAsByteArray();
        assertThat(back).isEqualTo(bytes);
    }

    @Test
    @DisplayName("TC-CLM-05 submit with 0 lines → 422; with lines → policy runs and status follows the outcome")
    void submit() throws Exception {
        Employee e = emp("EMPLOYEE", null);
        String t = token(e);
        long empty = createClaim(t, "Empty");
        post("/api/claims/" + empty + "/submit", t, Map.of("version", version(empty, t)), 422);

        long small = createClaim(t, "Lunch");
        addLine(small, t, line(Category.MEAL, "450.00", weekday(), "Cafe", CityTier.OTHER, null));
        JsonNode d = submit(small, t);
        assertThat(d.at("/claim/status").asText()).isEqualTo("APPROVED");
        assertThat(d.at("/claim/policyOutcome").asText()).isEqualTo("AUTO_APPROVE");
        assertThat(auditCount(small, "CLAIM_SUBMITTED")).isEqualTo(1);
        assertThat(auditCount(small, "POLICY_EVALUATED")).isEqualTo(1);
        assertThat(auditCount(small, "CLAIM_AUTO_APPROVED")).isEqualTo(1);
    }

    @Test
    @DisplayName("TC-CLM-06 demo login issues a 60-min JWT with roles; role picker lists users")
    void demoLogin() throws Exception {
        Employee m = emp("EMPLOYEE,MANAGER", null);
        JsonNode users = get("/api/auth/demo-users", null, 200);
        assertThat(users.size()).isGreaterThan(0);
        JsonNode login = post("/api/auth/demo-login", null, Map.of("employeeId", m.getId()), 200);
        String token = login.get("token").asText();
        assertThat(texts(login.at("/user/roles"))).contains("MANAGER", "EMPLOYEE");
        var jwtDecoded = jwt.decoder().decode(token);
        assertThat(jwtDecoded.getExpiresAt().getEpochSecond() - jwtDecoded.getIssuedAt().getEpochSecond())
                .isEqualTo(3600);
        assertThat(get("/api/me", token, 200).get("id").asLong()).isEqualTo(m.getId());
    }

    @Test
    @DisplayName("BR-01 only the owner edits, only in DRAFT/SENT_BACK; a submitted claim is locked")
    void ownerOnlyAndLocked() throws Exception {
        Employee mgr = emp("EMPLOYEE,MANAGER", null);
        Employee e = emp("EMPLOYEE", mgr);
        String t = token(e);
        long id = createClaim(t, "Locked");
        long lineId = addReceiptedLine(id, t, "9000.00");
        // manager can see but cannot edit → 403; stranger cannot see → 404
        post("/api/claims/" + id + "/lines", token(mgr), line(Category.MEAL, "10.00", weekday(), "x", CityTier.OTHER, null), 403);
        post("/api/claims/" + id + "/lines", token(emp("EMPLOYEE", null)),
                line(Category.MEAL, "10.00", weekday(), "x", CityTier.OTHER, null), 404);
        submit(id, t);
        assertThat(status(id)).isEqualTo("PENDING_MANAGER");
        put("/api/claims/" + id + "/lines/" + lineId, t,
                line(Category.OTHER, "1.00", weekday(), "x", CityTier.OTHER, null), 422);
    }

    @Test
    @DisplayName("TC-SEC-04 edit after approval: API → 422 and the DB trigger blocks a direct UPDATE (R4)")
    void editAfterApproval() throws Exception {
        Employee e = emp("EMPLOYEE", null);
        String t = token(e);
        long id = createClaim(t, "Approved");
        long lineId = addLine(id, t, line(Category.MEAL, "120.00", weekday(), "Cafe", CityTier.OTHER, null));
        submit(id, t);
        assertThat(status(id)).isEqualTo("APPROVED");
        put("/api/claims/" + id + "/lines/" + lineId, t,
                line(Category.MEAL, "999.00", weekday(), "Cafe", CityTier.OTHER, null), 422);
        assertThatThrownBy(() -> jdbc.update("UPDATE claim_line SET amount = 99999 WHERE id = ?", lineId))
                .hasMessageContaining("claim_line is locked");
        assertThatThrownBy(() -> jdbc.update("DELETE FROM claim_line WHERE id = ?", lineId))
                .hasMessageContaining("claim_line is locked");
    }

    @Test
    @DisplayName("TC-SEC-08 IDOR: another employee's claim and receipt both return 404 (R10)")
    void idor() throws Exception {
        Employee a = emp("EMPLOYEE", null);
        Employee b = emp("EMPLOYEE", null);
        String tb = token(b);
        long claimB = createClaim(tb, "B's claim");
        long line = addLine(claimB, tb, line(Category.OTHER, "800.00", weekday(), "Shop", CityTier.OTHER, null));
        long receipt = upload(claimB, line, tb, png(), "b.png", 201).get("receiptId").asLong();

        String ta = token(a);
        get("/api/claims/" + claimB, ta, 404);
        get("/api/receipts/" + receipt, ta, 404);
        post("/api/claims/" + claimB + "/comments", ta, Map.of("body", "hi"), 404);
        get("/api/audit?claimId=" + claimB, ta, 404);
        assertThat(get("/api/claims", ta, 200).get("totalElements").asLong()).isZero();
    }

    @Test
    @DisplayName("TC-SEC-09 mass assignment: status / employeeId in JSON → 400, state unchanged (R11)")
    void massAssignment() throws Exception {
        Employee e = emp("EMPLOYEE", null);
        String t = token(e);
        post("/api/claims", t, "{\"title\":\"x\",\"status\":\"APPROVED\"}", 400);
        long id = createClaim(t, "Mass");
        Map<String, Object> l = new HashMap<>(line(Category.MEAL, "100.00", weekday(), "C", CityTier.OTHER, null));
        l.put("employeeId", 1);
        post("/api/claims/" + id + "/lines", t, l, 400);
        patch("/api/claims/" + id, t, "{\"title\":\"y\",\"version\":0,\"totalAmount\":1}", 400);
        assertThat(status(id)).isEqualTo("DRAFT");
    }

    @Test
    @DisplayName("TC-SEC-11 there is no endpoint to change your own manager or roles (R13)")
    void noProfileEdit() throws Exception {
        Employee e = emp("EMPLOYEE", null);
        int s = call(MockMvcRequestBuilders.patch("/api/me"), token(e), "{\"roles\":\"FINANCE_HEAD\"}", 405)
                .getResponse().getStatus();
        assertThat(s).isEqualTo(405);
        assertThat(employees.findById(e.getId()).orElseThrow().roleSet()).containsExactly(Role.EMPLOYEE);
    }

    @Test
    @DisplayName("TC-SEC-13 upload: HTML renamed .jpg → 415, 6 MB → 413, '../../x.png' name sanitised (R18)")
    void maliciousUpload() throws Exception {
        String t = token(emp("EMPLOYEE", null));
        long id = createClaim(t, "Uploads");
        long line = addLine(id, t, line(Category.OTHER, "900.00", weekday(), "Shop", CityTier.OTHER, null));

        byte[] html = "<html><script>alert(1)</script></html>".getBytes(StandardCharsets.UTF_8);
        upload(id, line, t, html, "receipt.jpg", 415);

        byte[] big = new byte[6 * 1024 * 1024];
        big[0] = (byte) 0xFF;
        big[1] = (byte) 0xD8;
        big[2] = (byte) 0xFF;
        int s = mvc.perform(MockMvcRequestBuilders.multipart("/api/claims/" + id + "/lines/" + line + "/receipt")
                        .file(new MockMultipartFile("file", "big.jpg", "image/jpeg", big))
                        .header("Authorization", "Bearer " + t))
                .andReturn().getResponse().getStatus();
        assertThat(s).isEqualTo(413);

        JsonNode ok = upload(id, line, t, png(), "../../x.png", 201);
        assertThat(ok.get("originalName").asText()).isEqualTo("x.png");
        var resp = call(MockMvcRequestBuilders.get("/api/receipts/" + ok.get("receiptId").asLong()), t, null, 200)
                .getResponse();
        assertThat(resp.getHeader("Content-Disposition")).startsWith("attachment");
        assertThat(resp.getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
    }

    @Test
    @DisplayName("TC-SEC-14 expired or tampered JWT → 401")
    void badTokens() throws Exception {
        Employee e = emp("EMPLOYEE", null);
        String expired = jwt.issueAt(e.getId(), e.getName(), Set.of(Role.EMPLOYEE),
                Instant.now().minusSeconds(7200)).token();
        get("/api/me", expired, 401);
        String good = token(e);
        String tampered = good.substring(0, good.length() - 4) + (good.endsWith("AAAA") ? "BBBB" : "AAAA");
        get("/api/me", tampered, 401);
    }

    @Test
    @DisplayName("TC-SEC-15 SQL injection in sort/filter → 400")
    void sortInjection() throws Exception {
        Employee aud = emp("EMPLOYEE,AUDITOR", null);
        get("/api/claims?sort=amount;drop table claim", token(aud), 400);
        get("/api/auditor/queue?sort=amount;drop", token(aud), 400);
        get("/api/auditor/queue?flag=x' or 1=1--", token(aud), 400);
        get("/api/auditor/queue?category=MEAL;drop", token(aud), 400);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM claim", Long.class)).isNotNull();
    }

    @Test
    @DisplayName("TC-SEC-16 demo login is rate-limited: the 11th attempt in a minute → 429")
    void rateLimit() throws Exception {
        Employee e = emp("EMPLOYEE", null);
        for (int i = 0; i < 10; i++) {
            post("/api/auth/demo-login", null, Map.of("employeeId", e.getId()), 200);
        }
        post("/api/auth/demo-login", null, Map.of("employeeId", e.getId()), 429);
    }

    @Test
    @DisplayName("BR-03 a policy-rejected claim cannot be edited but can be copied to a new draft")
    void copyRejected() throws Exception {
        String t = token(emp("EMPLOYEE", null));
        long id = createClaim(t, "No receipt");
        long line = addLine(id, t, line(Category.OTHER, "700.00", weekday(), "Shop", CityTier.OTHER, null));
        submit(id, t);
        assertThat(status(id)).isEqualTo("POLICY_REJECTED");
        put("/api/claims/" + id + "/lines/" + line, t, line(Category.OTHER, "1.00", weekday(), "S", CityTier.OTHER, null), 422);
        JsonNode copy = post("/api/claims/" + id + "/copy", t, null, 201);
        assertThat(copy.at("/claim/status").asText()).isEqualTo("DRAFT");
        assertThat(copy.get("lines")).hasSize(1);
        assertThat(copy.at("/permissions/canEdit").asBoolean()).isTrue();
    }

    @Test
    @DisplayName("EF-004 policy preview is a dry run: shows RECEIPT_REQUIRED and clears once a receipt is attached")
    void preview() throws Exception {
        String t = token(emp("EMPLOYEE", null));
        long id = createClaim(t, "Preview");
        long line = addLine(id, t, line(Category.OTHER, "700.00", weekday(), "Shop", CityTier.OTHER, null));
        JsonNode p = post("/api/claims/" + id + "/policy-preview", t, null, 200);
        assertThat(p.get("claimOutcome").asText()).isEqualTo("AUTO_REJECT");
        assertThat(p.at("/lines/0/results/0/ruleCode").asText()).isEqualTo("RECEIPT_REQUIRED");
        upload(id, line, t, png(), "r.png", 201);
        assertThat(post("/api/claims/" + id + "/policy-preview", t, null, 200).get("claimOutcome").asText())
                .isEqualTo("AUTO_APPROVE");
        assertThat(status(id)).isEqualTo("DRAFT");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM policy_result pr JOIN claim_line l ON l.id = pr.claim_line_id "
                + "WHERE l.claim_id = ?", Long.class, id)).isZero();
    }

    @Test
    @DisplayName("Stale version on submit → 409 (BR-28)")
    void staleSubmit() throws Exception {
        String t = token(emp("EMPLOYEE", null));
        long id = createClaim(t, "Stale");
        int v = version(id, t);
        addLine(id, t, line(Category.MEAL, "100.00", weekday(), "C", CityTier.OTHER, null));
        post("/api/claims/" + id + "/submit", t, Map.of("version", v), 409);
    }
}
