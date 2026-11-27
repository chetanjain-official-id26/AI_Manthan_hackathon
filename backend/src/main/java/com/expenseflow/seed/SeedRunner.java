package com.expenseflow.seed;

import com.expenseflow.approval.ApprovalService;
import com.expenseflow.approval.ApprovalStep;
import com.expenseflow.approval.ApprovalStepRepository;
import com.expenseflow.approval.StepStatus;
import com.expenseflow.claim.Category;
import com.expenseflow.claim.CityTier;
import com.expenseflow.claim.Claim;
import com.expenseflow.claim.ClaimDtos.LineRequest;
import com.expenseflow.claim.ClaimLine;
import com.expenseflow.claim.ClaimRepository;
import com.expenseflow.claim.ClaimService;
import com.expenseflow.claim.ClaimStatus;
import com.expenseflow.common.security.CurrentUser;
import com.expenseflow.common.security.Role;
import com.expenseflow.common.time.Ist;
import com.expenseflow.common.time.MutableClock;
import com.expenseflow.payout.PayoutService;
import com.expenseflow.user.DelegationService;
import com.expenseflow.user.Department;
import com.expenseflow.user.DepartmentRepository;
import com.expenseflow.user.Employee;
import com.expenseflow.user.EmployeeRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;

/**
 * Synthetic seed (EF-036, EF-037). Runs only with the "seed" profile, drives the real services with
 * a pinned clock so every claim has genuine policy results, approval steps, audit rows and payouts.
 * Idempotent: if employees already exist it prints the summary and exits without adding anything.
 * All names, accounts and receipts are synthetic.
 */
@Component
@Profile("seed")
public class SeedRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SeedRunner.class);

    static final int EMPLOYEES = 150;
    static final int CLAIMS = 3000;
    static final int PLANT_DUP_VENDOR = 40;
    static final int PLANT_DUP_HASH = 15;
    static final int PLANT_BREACH = 60;
    static final int PLANT_WEEKEND = 50;
    static final int PLANT_OVER_25K = 30;
    static final int PLANT_OVER_1L = 10;
    static final int PLANT_NO_RECEIPT = 20;

    private final EmployeeRepository employees;
    private final DepartmentRepository departments;
    private final ClaimService claimService;
    private final ClaimRepository claims;
    private final ApprovalService approvals;
    private final ApprovalStepRepository steps;
    private final DelegationService delegations;
    private final PayoutService payouts;
    private final TransactionTemplate tx;
    private final JdbcTemplate jdbc;
    private final MutableClock clock;
    private final ConfigurableApplicationContext ctx;

    private final Random rnd = new Random(20261127L);
    private final Map<Long, CurrentUser> users = new HashMap<>();
    private final Map<Long, List<PastLine>> pastLines = new HashMap<>();
    private final List<PastReceipt> pastReceipts = new ArrayList<>();
    private Instant now;

    private record PastLine(Category category, BigDecimal amount, LocalDate date, String vendor, CityTier tier,
                            Integer nights) {
    }

    private record PastReceipt(Long employeeId, byte[] bytes) {
    }

    private enum Plant { NONE, DUP_VENDOR, DUP_HASH, BREACH, WEEKEND, OVER_25K, OVER_1L, NO_RECEIPT }

    public SeedRunner(EmployeeRepository employees, DepartmentRepository departments, ClaimService claimService,
                      ClaimRepository claims, ApprovalService approvals, ApprovalStepRepository steps,
                      DelegationService delegations, PayoutService payouts, TransactionTemplate tx,
                      JdbcTemplate jdbc, MutableClock clock, ConfigurableApplicationContext ctx) {
        this.employees = employees;
        this.departments = departments;
        this.claimService = claimService;
        this.claims = claims;
        this.approvals = approvals;
        this.steps = steps;
        this.delegations = delegations;
        this.payouts = payouts;
        this.tx = tx;
        this.jdbc = jdbc;
        this.clock = clock;
        this.ctx = ctx;
    }

    @Override
    public void run(ApplicationArguments args) {
        long started = System.currentTimeMillis();
        int code = 0;
        try {
            boolean done = count("SELECT count(*) FROM app_config WHERE config_key = 'seed_completed'") > 0;
            if (done) {
                log.info("Seed: data already present, nothing added (idempotent re-run).");
            } else if (employees.count() > 0) {
                throw new IllegalStateException("Found data from an incomplete seed run. Reset with: "
                        + "docker compose -f ops/docker-compose.yml down -v");
            } else {
                seed();
                jdbc.update("INSERT INTO app_config (config_key, config_value, version) VALUES ('seed_completed', ?, 1)",
                        Instant.now().toString());
            }
            printSummary(System.currentTimeMillis() - started);
        } catch (RuntimeException e) {
            log.error("Seed failed", e);
            code = 1;
        } finally {
            clock.reset();
        }
        int exit = code;
        System.exit(SpringApplication.exit(ctx, () -> exit));
    }

    // ------------------------------------------------------------------ people

    private void seed() {
        now = Instant.now();
        List<Employee> staff = tx.execute(s -> createPeople());
        Map<String, Employee> byCode = new HashMap<>();
        staff.forEach(e -> byCode.put(e.getEmpCode(), e));
        staff.forEach(e -> users.put(e.getId(), new CurrentUser(e.getId(), e.getName(), e.roleSet())));

        // A historical delegation (manager EMP0008 on leave ~2 months ago) gives "on behalf of" history,
        // and an active one (EMP0006 â†’ EMP0007) is available for the live demo.
        LocalDate today = Ist.date(now);
        createDelegation(byCode.get("EMP0008"), byCode.get("EMP0009"), today.minusDays(65), today.minusDays(52),
                "Annual leave");
        createDelegation(byCode.get("EMP0006"), byCode.get("EMP0007"), today, today.plusDays(5), "Conference travel");

        List<Plant> plan = plantPlan();
        List<Instant> times = new ArrayList<>();
        for (int i = 0; i < CLAIMS; i++) {
            // ~6% in the last 5 days so the inbox and auditor queue have live work in the demo
            int maxMinutes = rnd.nextInt(100) < 6 ? 60 * 24 * 5 : 60 * 24 * 360;
            times.add(now.minus(Duration.ofMinutes(90 + rnd.nextInt(maxMinutes))));
        }
        Collections.sort(times);
        List<Employee> filers = staff.stream().filter(e -> !e.getEmpCode().equals("EMP0001") || rnd.nextBoolean()).toList();
        // Late plants need history (duplicates), so put them in the second half of the timeline.
        for (int i = 0; i < CLAIMS; i++) {
            Employee owner = filers.get(rnd.nextInt(filers.size()));
            Plant p = plan.get(i);
            Instant at = times.get(i);
            tx.executeWithoutResult(s -> oneClaim(owner, p, at));
            if ((i + 1) % 500 == 0) {
                log.info("Seed: {} / {} claims", i + 1, CLAIMS);
            }
        }
        runPayouts(byCode.get("EMP0001"));
    }

    private List<Employee> createPeople() {
        String[][] deps = {{"ENG", "Engineering"}, {"SAL", "Sales"}, {"MKT", "Marketing"}, {"FIN", "Finance"},
                {"HR", "Human Resources"}, {"OPS", "Operations"}, {"PRD", "Product"}, {"LEG", "Legal"}};
        List<Department> d = new ArrayList<>();
        for (String[] x : deps) {
            d.add(departments.save(new Department(x[0], x[1])));
        }
        Department fin = d.get(3);
        List<Employee> all = new ArrayList<>();
        Employee fh = person(1, "EMPLOYEE,FINANCE_HEAD", fin, null);
        all.add(fh);
        all.add(person(2, "EMPLOYEE,AUDITOR", fin, fh)); // alternate finance approver (app_config)
        for (int i = 3; i <= 5; i++) {
            all.add(person(i, "EMPLOYEE,AUDITOR", fin, fh));
        }
        List<Employee> managers = new ArrayList<>();
        for (int i = 6; i <= 21; i++) {
            Employee m = person(i, "EMPLOYEE,MANAGER", d.get((i - 6) % d.size()), fh);
            managers.add(m);
            all.add(m);
        }
        for (int i = 22; i <= EMPLOYEES; i++) {
            Employee mgr = managers.get(rnd.nextInt(managers.size()));
            all.add(person(i, "EMPLOYEE", departments.findById(mgr.getDepartmentId()).orElseThrow(), mgr));
        }
        return all;
    }

    private Employee person(int n, String roles, Department d, Employee manager) {
        Employee e = new Employee();
        e.setEmpCode(String.format("EMP%04d", n));
        String first = SeedNames.FIRST[rnd.nextInt(SeedNames.FIRST.length)];
        String last = SeedNames.LAST[rnd.nextInt(SeedNames.LAST.length)];
        e.setName(n == 1 ? "Kavita Menon" : n == 2 ? "Arjun Desai" : first + " " + last);
        e.setEmail(String.format("emp%04d@expenseflow.example", n));
        e.setRoles(roles);
        e.setDepartmentId(d.getId());
        e.setManagerId(manager == null ? null : manager.getId());
        e.setBankAccountMasked("XXXXXX" + (1000 + rnd.nextInt(9000)));
        e.setIfsc(String.format("SYNB0000%03d", rnd.nextInt(1000)));
        e.setCreatedAt(now.minus(Duration.ofDays(400)));
        return employees.save(e);
    }

    private void createDelegation(Employee from, Employee to, LocalDate start, LocalDate end, String reason) {
        clock.set(Ist.startOfDay(start).plus(Duration.ofHours(9)));
        tx.executeWithoutResult(s -> delegations.create(from.getId(), to.getId(), start, end, reason,
                users.get(from.getId()), false));
        clock.reset();
    }

    // ------------------------------------------------------------------ claims

    private List<Plant> plantPlan() {
        List<Plant> early = new ArrayList<>();
        List<Plant> late = new ArrayList<>();
        addN(late, Plant.DUP_VENDOR, PLANT_DUP_VENDOR);
        addN(late, Plant.DUP_HASH, PLANT_DUP_HASH);
        addN(early, Plant.BREACH, PLANT_BREACH);
        addN(early, Plant.WEEKEND, PLANT_WEEKEND);
        addN(early, Plant.OVER_25K, PLANT_OVER_25K);
        addN(early, Plant.OVER_1L, PLANT_OVER_1L);
        addN(early, Plant.NO_RECEIPT, PLANT_NO_RECEIPT);
        int half = CLAIMS / 2;
        List<Plant> first = new ArrayList<>(early.subList(0, early.size() / 2));
        while (first.size() < half) {
            first.add(Plant.NONE);
        }
        List<Plant> second = new ArrayList<>(early.subList(early.size() / 2, early.size()));
        second.addAll(late);
        while (second.size() < CLAIMS - half) {
            second.add(Plant.NONE);
        }
        Collections.shuffle(first, rnd);
        Collections.shuffle(second, rnd);
        first.addAll(second);
        return first;
    }

    private static void addN(List<Plant> l, Plant p, int n) {
        for (int i = 0; i < n; i++) {
            l.add(p);
        }
    }

    private void oneClaim(Employee owner, Plant plant, Instant submitAt) {
        CurrentUser u = users.get(owner.getId());
        Instant createdAt = submitAt.minus(Duration.ofHours(1 + rnd.nextInt(48)));
        clock.set(createdAt);
        LocalDate submitDay = Ist.date(submitAt);
        String city = SeedNames.CITIES[rnd.nextInt(SeedNames.CITIES.length)];
        CityTier tier = SeedNames.isTier1(city) ? CityTier.TIER_1 : CityTier.OTHER;
        Claim claim = claimService.create(SeedNames.TITLES[rnd.nextInt(SeedNames.TITLES.length)] + " - " + city, u);

        List<LineRequest> lines = normalLines(city, tier, submitDay, plant);
        switch (plant) {
            case BREACH -> lines.add(breachLine(city, tier, submitDay));
            case WEEKEND -> lines.add(weekendLine(city, tier, submitDay));
            case OVER_25K -> topUp(lines, city, tier, submitDay, money(25_001, 95_000));
            case OVER_1L -> topUp(lines, city, tier, submitDay, money(100_001, 250_000));
            case DUP_VENDOR -> {
                LineRequest dup = duplicateOfPast(owner.getId());
                if (dup != null) {
                    lines.add(dup);
                }
            }
            default -> {
            }
        }
        byte[] reusedReceipt = plant == Plant.DUP_HASH ? receiptOfAnotherEmployee(owner.getId()) : null;
        if (plant == Plant.DUP_HASH && reusedReceipt != null) {
            lines.add(new LineRequest(Category.OTHER, money(800, 4000), weekdayBefore(submitDay, 3, 15),
                    "Office supplies " + city, city, tier, null, "Supplies", null));
        }

        boolean dropReceipt = plant == Plant.NO_RECEIPT;
        for (int i = 0; i < lines.size(); i++) {
            LineRequest req = lines.get(i);
            ClaimLine l = claimService.addLine(claim.getId(), req, u);
            boolean last = i == lines.size() - 1;
            boolean needs = req.amount().compareTo(new BigDecimal("500.00")) > 0;
            if (dropReceipt && last) {
                if (!needs) {
                    // make sure the planted line really needs a receipt
                    claimService.updateLine(claim.getId(), l.getId(), withAmount(req, money(700, 3000)), u);
                }
                continue;
            }
            if (needs || rnd.nextInt(4) == 0) {
                byte[] bytes = (last && reusedReceipt != null) ? reusedReceipt : SeedNames.receiptBytes(rnd);
                claimService.uploadReceipt(claim.getId(), l.getId(), bytes, "receipt-" + (i + 1) + ".png", u);
                if (rnd.nextInt(10) == 0 && pastReceipts.size() < 400) {
                    pastReceipts.add(new PastReceipt(owner.getId(), bytes));
                }
            }
        }

        clock.set(submitAt);
        Claim c = claimService.submit(claim.getId(), claims.findById(claim.getId()).orElseThrow().getVersion(), u);
        if (c.getStatus() != ClaimStatus.POLICY_REJECTED) {
            List<PastLine> past = pastLines.computeIfAbsent(owner.getId(), k -> new ArrayList<>());
            for (ClaimLine l : c.getLines()) {
                if (l.getCategory() != Category.MEAL) { // meal copies would also trip the daily limit
                    past.add(new PastLine(l.getCategory(), l.getAmount(), l.getExpenseDate(), l.getVendor(),
                            l.getCityTier(), l.getNights()));
                }
            }
        }
        decide(c, submitAt, true);
    }

    /** Walks the approval chain with realistic delays; recent claims stay pending for the demo. */
    private void decide(Claim c, Instant from, boolean allowSendBack) {
        Instant t = from;
        Instant horizon = now.minus(Duration.ofHours(2));
        boolean stuck = rnd.nextInt(600) == 0; // a few claims stall, which feeds the oldest-pending alert
        while (true) {
            claims.flush(); // one transaction per claim: flush so the version we pass is the version in the DB
            Claim fresh = claims.findById(c.getId()).orElseThrow();
            if (!fresh.getStatus().pending()) {
                return;
            }
            ApprovalStep step = steps.findFirstByClaimIdAndStatus(c.getId(), StepStatus.PENDING).orElse(null);
            if (step == null) {
                return;
            }
            t = t.plus(Duration.ofMinutes(60L * (2 + rnd.nextInt(58)) + rnd.nextInt(60)));
            if (t.isAfter(horizon) || stuck) {
                return;
            }
            clock.set(t);
            CurrentUser actor = actorFor(step, fresh, t);
            if (actor == null) {
                return;
            }
            int roll = rnd.nextInt(100);
            if (roll < 4) {
                approvals.reject(c.getId(), fresh.getVersion(), "Not within policy intent", actor);
                return;
            }
            if (roll < 10 && allowSendBack) {
                approvals.sendBack(c.getId(), fresh.getVersion(), "Please attach itemised bills", actor);
                if (rnd.nextInt(10) < 7) {
                    Instant resubmitAt = t.plus(Duration.ofHours(12 + rnd.nextInt(60)));
                    if (resubmitAt.isBefore(horizon)) {
                        clock.set(resubmitAt);
                        CurrentUser owner = users.get(fresh.getEmployeeId());
                        Claim back = claims.findById(c.getId()).orElseThrow();
                        Claim resubmitted = claimService.submit(c.getId(), back.getVersion(), owner);
                        decide(resubmitted, resubmitAt, false);
                    }
                }
                return;
            }
            approvals.approve(c.getId(), fresh.getVersion(), null, actor);
        }
    }

    private CurrentUser actorFor(ApprovalStep step, Claim claim, Instant at) {
        if (step.getAssigneeId() != null) {
            Long assignee = step.getAssigneeId();
            // EMP0008's steps during the historical leave are approved by the delegate (on behalf of)
            Employee a = employees.findById(assignee).orElseThrow();
            if (a.getEmpCode().equals("EMP0008")) {
                LocalDate day = Ist.date(at);
                LocalDate today = Ist.date(now);
                if (!day.isBefore(today.minusDays(65)) && !day.isAfter(today.minusDays(52))) {
                    Employee d = employees.findByEmpCode("EMP0009").orElseThrow();
                    if (!d.getId().equals(claim.getEmployeeId())) {
                        return users.get(d.getId());
                    }
                }
            }
            return users.get(assignee);
        }
        Role role = Role.valueOf(step.getAssigneeRole());
        List<CurrentUser> pool = users.values().stream()
                .filter(x -> x.has(role) && !x.id().equals(claim.getEmployeeId()))
                .sorted((a, b) -> Long.compare(a.id(), b.id())).toList();
        return pool.isEmpty() ? null : pool.get(rnd.nextInt(pool.size()));
    }

    private void runPayouts(Employee fh) {
        CurrentUser u = users.get(fh.getId());
        YearMonth current = YearMonth.from(Ist.date(now));
        for (int back = 11; back >= 1; back--) {
            YearMonth ym = current.minusMonths(back);
            Instant cutoff = Ist.startOfDay(ym.plusMonths(1).atDay(3)).plus(Duration.ofHours(11));
            if (cutoff.isAfter(now)) {
                continue;
            }
            clock.set(cutoff);
            List<Long> ids = tx.execute(s -> payouts.eligible().stream()
                    .filter(c -> c.getApprovedAt() != null && c.getApprovedAt().isBefore(cutoff))
                    .map(Claim::getId).toList());
            if (ids == null || ids.isEmpty()) {
                continue;
            }
            Long batchId = tx.execute(s -> payouts.create(ids, u).getId());
            clock.set(cutoff.plus(Duration.ofHours(2)));
            tx.executeWithoutResult(s -> payouts.export(batchId, u));
            clock.set(cutoff.plus(Duration.ofDays(1)));
            tx.executeWithoutResult(s -> payouts.markPaid(batchId, payouts.get(batchId).getVersion(), u));
        }
        clock.reset();
    }

    // ------------------------------------------------------------------ line generators

    private List<LineRequest> normalLines(String city, CityTier tier, LocalDate submitDay, Plant plant) {
        List<LineRequest> out = new ArrayList<>();
        int n = 1 + rnd.nextInt(plant == Plant.NONE ? 4 : 2);
        Set<LocalDate> mealDays = new HashSet<>();
        for (int i = 0; i < n; i++) {
            LocalDate d = weekdayBefore(submitDay, 3, 20);
            int kind = rnd.nextInt(100);
            if (kind < 35 && mealDays.add(d)) {
                out.add(new LineRequest(Category.MEAL, money(150, 700), d, SeedNames.vendor(rnd, "MEAL"), city, tier,
                        null, "Meal", null));
            } else if (kind < 65) {
                out.add(new LineRequest(Category.CAB, money(120, 1800), d, SeedNames.vendor(rnd, "CAB"), city, tier,
                        null, "Local travel", null));
            } else if (kind < 85) {
                int nights = 1 + rnd.nextInt(3);
                int perNight = tier == CityTier.TIER_1 ? 2500 + rnd.nextInt(3400) : 1800 + rnd.nextInt(2100);
                out.add(new LineRequest(Category.HOTEL, money(perNight * nights - 50, perNight * nights), d,
                        SeedNames.vendor(rnd, "HOTEL"), city, tier, nights, "Stay", null));
            } else {
                out.add(new LineRequest(Category.OTHER, money(200, 6000), d, SeedNames.vendor(rnd, "OTHER"), city,
                        tier, null, "Misc", null));
            }
        }
        return out;
    }

    private LineRequest breachLine(String city, CityTier tier, LocalDate submitDay) {
        LocalDate d = weekdayBefore(submitDay, 3, 20);
        return switch (rnd.nextInt(3)) {
            case 0 -> new LineRequest(Category.MEAL, money(1600, 2600), d, SeedNames.vendor(rnd, "MEAL"), city, tier,
                    null, "Client dinner", null);
            case 1 -> {
                int nights = 1 + rnd.nextInt(2);
                int limit = tier == CityTier.TIER_1 ? 6000 : 4000;
                yield new LineRequest(Category.HOTEL, money((limit + 300) * nights, (limit + 2500) * nights), d,
                        SeedNames.vendor(rnd, "HOTEL"), city, tier, nights, "Premium stay", null);
            }
            default -> new LineRequest(Category.CAB, money(2100, 3600), d, SeedNames.vendor(rnd, "CAB"), city, tier,
                    null, "Outstation cab", null);
        };
    }

    private LineRequest weekendLine(String city, CityTier tier, LocalDate submitDay) {
        LocalDate d = submitDay.minusDays(3 + rnd.nextInt(14));
        while (d.getDayOfWeek() != DayOfWeek.SATURDAY && d.getDayOfWeek() != DayOfWeek.SUNDAY) {
            d = d.minusDays(1);
        }
        return new LineRequest(Category.CAB, money(150, 1500), d, SeedNames.vendor(rnd, "CAB"), city, tier, null,
                "Weekend travel", null);
    }

    private void topUp(List<LineRequest> lines, String city, CityTier tier, LocalDate submitDay, BigDecimal target) {
        BigDecimal sum = lines.stream().map(LineRequest::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal remaining = target.subtract(sum);
        while (remaining.compareTo(new BigDecimal("1000")) > 0) {
            BigDecimal chunk = remaining.min(money(15_000, 60_000));
            lines.add(new LineRequest(Category.OTHER, chunk, weekdayBefore(submitDay, 3, 20),
                    SeedNames.vendor(rnd, "BIG"), city, tier, null, "Travel / event", null));
            remaining = remaining.subtract(chunk);
        }
    }

    private LineRequest duplicateOfPast(Long employeeId) {
        List<PastLine> past = pastLines.get(employeeId);
        if (past == null || past.isEmpty()) {
            // fall back to any employee with history; the duplicate must be the same employee, so pick theirs
            return null;
        }
        PastLine p = past.get(rnd.nextInt(past.size()));
        String variant = rnd.nextBoolean() ? p.vendor().toUpperCase() + "." : "  " + p.vendor().toLowerCase() + " ";
        return new LineRequest(p.category(), p.amount(), p.date(), variant, null, p.tier(), p.nights(),
                "Duplicate entry", null);
    }

    private byte[] receiptOfAnotherEmployee(Long employeeId) {
        List<PastReceipt> others = pastReceipts.stream().filter(r -> !r.employeeId().equals(employeeId)).toList();
        return others.isEmpty() ? null : others.get(rnd.nextInt(others.size())).bytes();
    }

    private static LineRequest withAmount(LineRequest r, BigDecimal amount) {
        return new LineRequest(r.category(), amount, r.expenseDate(), r.vendor(), r.city(), r.cityTier(), r.nights(),
                r.description(), null);
    }

    private LocalDate weekdayBefore(LocalDate day, int minBack, int maxBack) {
        LocalDate d = day.minusDays(minBack + rnd.nextInt(maxBack - minBack + 1));
        while (d.getDayOfWeek() == DayOfWeek.SATURDAY || d.getDayOfWeek() == DayOfWeek.SUNDAY) {
            d = d.minusDays(1);
        }
        return d;
    }

    private BigDecimal money(int min, int max) {
        long paise = (long) min * 100 + (long) (rnd.nextDouble() * ((long) (max - min) * 100));
        return BigDecimal.valueOf(paise, 2).setScale(2, RoundingMode.UNNECESSARY);
    }

    // ------------------------------------------------------------------ summary

    private void printSummary(long ms) {
        long emp = count("SELECT count(*) FROM employee");
        long cl = count("SELECT count(*) FROM claim");
        String byStatus = String.join(", ", jdbc.query(
                "SELECT status, count(*) FROM claim GROUP BY status ORDER BY 2 DESC",
                (rs, i) -> rs.getString(1) + "=" + rs.getLong(2)));
        long dupVendor = count("SELECT count(DISTINCT claim_line_id) FROM policy_result WHERE rule_code = 'DUPLICATE_VENDOR_AMOUNT_DATE'");
        long dupHash = count("SELECT count(DISTINCT claim_line_id) FROM policy_result WHERE rule_code = 'DUPLICATE_RECEIPT_HASH'");
        long breach = count("SELECT count(DISTINCT claim_line_id) FROM policy_result WHERE flag = 'OVER_LIMIT'");
        long weekend = count("SELECT count(DISTINCT claim_line_id) FROM policy_result WHERE rule_code = 'WEEKEND_SPEND'");
        long over25 = count("SELECT count(*) FROM claim WHERE total_amount > 25000 AND status <> 'DRAFT'");
        long over1L = count("SELECT count(*) FROM claim WHERE total_amount > 100000 AND status <> 'DRAFT'");
        long sampled = count("SELECT count(*) FROM claim WHERE sample_audit");
        long split = count("SELECT count(*) FROM claim WHERE split_suspect");
        long batches = count("SELECT count(*) FROM payout_batch");
        String demo = String.join("\n", jdbc.query(
                "SELECT DISTINCT ON (role) role, emp_code, name FROM (SELECT CASE WHEN roles LIKE '%FINANCE_HEAD%' THEN '1 Finance Head' "
                        + "WHEN roles LIKE '%AUDITOR%' THEN '2 Auditor' WHEN roles LIKE '%MANAGER%' THEN '3 Manager' "
                        + "ELSE '4 Employee' END AS role, emp_code, name FROM employee) x ORDER BY role, emp_code",
                (rs, i) -> String.format("  %-15s %s  %s", rs.getString(1).substring(2), rs.getString(2), rs.getString(3))));
        String summary = """

                ================ ExpenseFlow seed summary (synthetic data) ================
                Employees: %d    Claims: %d    Payout batches: %d    (%.1f s)
                Claims by status: %s
                Planted anomalies (planted â†’ lines/claims detected by the engine):
                  duplicate vendor+amount+date  %3d â†’ %d
                  duplicate receipt hash        %3d â†’ %d
                  limit breaches (OVER_LIMIT)   %3d â†’ %d
                  weekend spend                 %3d â†’ %d
                  claims > 25,000               %3d â†’ %d
                  claims > 1,00,000             %3d â†’ %d
                Sample-audited claims: %d    Split suspects: %d
                Demo users (pick on the login screen):
                %s
                  Active delegation: EMP0006 â†’ EMP0007 (today + 5 days)
                ===========================================================================
                """.formatted(emp, cl, batches, ms / 1000.0, byStatus,
                PLANT_DUP_VENDOR, dupVendor, PLANT_DUP_HASH, dupHash, PLANT_BREACH, breach, PLANT_WEEKEND, weekend,
                PLANT_OVER_25K, over25, PLANT_OVER_1L, over1L, sampled, split, demo);
        System.out.println(summary);
    }

    private long count(String sql) {
        Long n = jdbc.queryForObject(sql, Long.class);
        return n == null ? 0 : n;
    }
}
