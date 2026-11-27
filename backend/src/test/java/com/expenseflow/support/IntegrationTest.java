package com.expenseflow.support;

import com.expenseflow.claim.Category;
import com.expenseflow.claim.CityTier;
import com.expenseflow.common.security.JwtService;
import com.expenseflow.common.security.Role;
import com.expenseflow.common.time.Ist;
import com.expenseflow.common.time.MutableClock;
import com.expenseflow.user.DemoLoginRateLimiter;
import com.expenseflow.user.Department;
import com.expenseflow.user.DepartmentRepository;
import com.expenseflow.user.Employee;
import com.expenseflow.user.EmployeeRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.AbstractMockHttpServletRequestBuilder;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.security.SecureRandom;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;

import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

/**
 * Base for API/integration tests: one Postgres 18 container and one Spring context for the whole
 * run. Every test creates its own employees, so tests do not depend on each other's data.
 */
@SpringBootTest(properties = {
        "expenseflow.jwt.secret=test-secret-that-is-definitely-longer-than-32-bytes",
        "expenseflow.demo-login.enabled=true",
        "expenseflow.sample-audit.seed=42",
        "expenseflow.metrics.refresh-ms=600000"
})
@AutoConfigureMockMvc
public abstract class IntegrationTest {

    static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(DockerImageName.parse("postgres:18"));
    private static final AtomicInteger SEQ = new AtomicInteger();
    private static final SecureRandom RND = new SecureRandom();
    private static volatile boolean configured;

    static {
        POSTGRES.start();
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) throws Exception {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("expenseflow.receipts.dir", () -> {
            try {
                return Files.createTempDirectory("ef-receipts").toString();
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        });
    }

    @Autowired
    protected MockMvc mvc;
    @Autowired
    protected JsonMapper json;
    @Autowired
    protected JdbcTemplate jdbc;
    @Autowired
    protected EmployeeRepository employees;
    @Autowired
    protected DepartmentRepository departments;
    @Autowired
    protected JwtService jwt;
    @Autowired
    protected MutableClock clock;
    @Autowired
    protected DemoLoginRateLimiter limiter;

    @BeforeEach
    void baseSetUp() {
        if (!configured) {
            synchronized (IntegrationTest.class) {
                if (!configured) {
                    // Deterministic routing: no random sample audit unless a test turns it on.
                    jdbc.update("UPDATE app_config SET config_value = '0.00' WHERE config_key = 'sample_audit_rate'");
                    if (employees.findByEmpCode("EMP0002").isEmpty()) {
                        Employee alt = new Employee();
                        alt.setEmpCode("EMP0002");
                        alt.setName("Alternate Approver");
                        alt.setEmail("emp0002@expenseflow.test");
                        alt.setRoles("EMPLOYEE,AUDITOR");
                        employees.save(alt);
                    }
                    configured = true;
                }
            }
        }
        limiter.reset();
    }

    @AfterEach
    void baseTearDown() {
        clock.reset();
    }

    // ------------------------------------------------------------------ people

    protected Department dept(String code) {
        return departments.findByCode(code).orElseGet(() -> departments.save(new Department(code, code + " dept")));
    }

    protected Employee emp(String roles, Employee manager) {
        return emp(roles, manager, dept("ENG"));
    }

    protected Employee emp(String roles, Employee manager, Department d) {
        int n = SEQ.incrementAndGet();
        String suffix = Long.toString(System.nanoTime(), 36) + n;
        Employee e = new Employee();
        e.setEmpCode("T" + suffix.toUpperCase());
        e.setName("Test " + roles.split(",")[0] + " " + n);
        e.setEmail("t" + suffix + "@expenseflow.test");
        e.setRoles(roles);
        e.setDepartmentId(d.getId());
        e.setManagerId(manager == null ? null : manager.getId());
        e.setBankAccountMasked("XXXXXX" + (1000 + n % 9000));
        e.setIfsc("SYNB0000" + (100 + n % 900));
        return employees.save(e);
    }

    protected String token(Employee e) {
        return jwt.issue(e.getId(), e.getName(), Role.parse(e.getRoles())).token();
    }

    // ------------------------------------------------------------------ HTTP

    protected MvcResult call(AbstractMockHttpServletRequestBuilder<?> req, String token, Object body, int expectStatus)
            throws Exception {
        if (token != null) {
            req.header("Authorization", "Bearer " + token);
        }
        if (body != null) {
            req.contentType(MediaType.APPLICATION_JSON).content(body instanceof String s ? s : json.writeValueAsString(body));
        }
        MvcResult r = mvc.perform(req).andReturn();
        int status = r.getResponse().getStatus();
        if (status != expectStatus) {
            throw new AssertionError("Expected HTTP " + expectStatus + " but got " + status + ": "
                    + r.getResponse().getContentAsString());
        }
        return r;
    }

    protected JsonNode body(MvcResult r) throws Exception {
        String s = r.getResponse().getContentAsString();
        return s.isEmpty() ? null : json.readTree(s);
    }

    protected JsonNode get(String url, String token, int status) throws Exception {
        return body(call(MockMvcRequestBuilders.get(url), token, null, status));
    }

    protected JsonNode post(String url, String token, Object body, int status) throws Exception {
        return body(call(MockMvcRequestBuilders.post(url), token, body == null ? "{}" : body, status));
    }

    protected JsonNode put(String url, String token, Object body, int status) throws Exception {
        return body(call(MockMvcRequestBuilders.put(url), token, body, status));
    }

    protected JsonNode patch(String url, String token, Object body, int status) throws Exception {
        return body(call(MockMvcRequestBuilders.patch(url), token, body, status));
    }

    // ------------------------------------------------------------------ claims

    protected LocalDate today() {
        return Ist.date(clock.instant());
    }

    /** A weekday a few days back, so tests do not trip WEEKEND or STALE by accident. */
    protected LocalDate weekday() {
        LocalDate d = today().minusDays(3);
        while (d.getDayOfWeek() == DayOfWeek.SATURDAY || d.getDayOfWeek() == DayOfWeek.SUNDAY) {
            d = d.minusDays(1);
        }
        return d;
    }

    protected long createClaim(String token, String title) throws Exception {
        return post("/api/claims", token, Map.of("title", title), 201).at("/claim/id").asLong();
    }

    protected Map<String, Object> line(Category cat, String amount, LocalDate date, String vendor, CityTier tier,
                                       Integer nights) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("category", cat.name());
        m.put("amount", new BigDecimal(amount));
        m.put("expenseDate", date.toString());
        m.put("vendor", vendor);
        m.put("city", tier == CityTier.TIER_1 ? "Mumbai" : "Indore");
        m.put("cityTier", tier.name());
        if (nights != null) {
            m.put("nights", nights);
        }
        return m;
    }

    /** Adds a line and returns its id (the last line of the returned claim). */
    protected long addLine(long claimId, String token, Map<String, Object> line) throws Exception {
        JsonNode d = post("/api/claims/" + claimId + "/lines", token, line, 201);
        long max = 0;
        for (JsonNode l : d.get("lines")) {
            max = Math.max(max, l.get("id").asLong());
        }
        return max;
    }

    protected static byte[] png() {
        byte[] b = new byte[256];
        RND.nextBytes(b);
        byte[] magic = {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A};
        System.arraycopy(magic, 0, b, 0, magic.length);
        return b;
    }

    protected JsonNode upload(long claimId, long lineId, String token, byte[] bytes, String name, int status)
            throws Exception {
        MockMultipartFile f = new MockMultipartFile("file", name, "image/png", bytes);
        return body(call(MockMvcRequestBuilders.multipart("/api/claims/" + claimId + "/lines/" + lineId + "/receipt").file(f), token, null,
                status));
    }

    /** Adds an OTHER line with a fresh receipt (so it never trips RECEIPT_REQUIRED). */
    protected long addReceiptedLine(long claimId, String token, String amount) throws Exception {
        long lineId = addLine(claimId, token, line(Category.OTHER, amount, weekday(), "Vendor " + SEQ.incrementAndGet(),
                CityTier.TIER_1, null));
        upload(claimId, lineId, token, png(), "r.png", 201);
        return lineId;
    }

    protected int version(long claimId, String token) throws Exception {
        return get("/api/claims/" + claimId, token, 200).at("/claim/version").asInt();
    }

    protected JsonNode submit(long claimId, String token) throws Exception {
        return post("/api/claims/" + claimId + "/submit", token, Map.of("version", version(claimId, token)), 200);
    }

    /** Creates and submits a single-line claim of the given total for {@code owner}. */
    protected long submittedClaim(Employee owner, String total) throws Exception {
        String t = token(owner);
        long id = createClaim(t, "Claim " + total);
        addReceiptedLine(id, t, total);
        submit(id, t);
        return id;
    }

    protected String status(long claimId) {
        return jdbc.queryForObject("SELECT status FROM claim WHERE id = ?", String.class, claimId);
    }

    protected int claimVersion(long claimId) {
        return jdbc.queryForObject("SELECT version FROM claim WHERE id = ?", Integer.class, claimId);
    }

    protected JsonNode approve(long claimId, Employee approver, int expectStatus) throws Exception {
        return post("/api/claims/" + claimId + "/approve", token(approver),
                Map.of("version", claimVersion(claimId)), expectStatus);
    }

    protected long auditCount(long claimId, String action) {
        return jdbc.queryForObject("SELECT count(*) FROM audit_event WHERE claim_id = ? AND action = ?", Long.class,
                claimId, action);
    }

    protected static Set<String> texts(JsonNode arr) {
        Set<String> s = new java.util.LinkedHashSet<>();
        arr.forEach(n -> s.add(n.asText()));
        return s;
    }
}
