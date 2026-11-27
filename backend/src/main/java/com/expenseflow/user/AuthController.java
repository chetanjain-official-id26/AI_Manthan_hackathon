package com.expenseflow.user;

import com.expenseflow.common.error.ApiException;
import com.expenseflow.common.security.CurrentUser;
import com.expenseflow.common.security.JwtService;
import com.expenseflow.common.security.Role;
import com.expenseflow.common.time.Ist;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Set;

/** Demo login with a role picker (EF-035). Enabled only with the demo profile (R20). */
@RestController
@RequestMapping("/api")
public class AuthController {

    private final EmployeeRepository employees;
    private final DepartmentRepository departments;
    private final DelegationRepository delegations;
    private final JwtService jwt;
    private final DemoLoginRateLimiter limiter;
    private final Clock clock;
    private final boolean demoEnabled;

    public AuthController(EmployeeRepository employees, DepartmentRepository departments,
                          DelegationRepository delegations, JwtService jwt, DemoLoginRateLimiter limiter,
                          Clock clock, @Value("${expenseflow.demo-login.enabled:false}") boolean demoEnabled) {
        this.employees = employees;
        this.departments = departments;
        this.delegations = delegations;
        this.jwt = jwt;
        this.limiter = limiter;
        this.clock = clock;
        this.demoEnabled = demoEnabled;
    }

    public record DemoUser(Long id, String empCode, String name, Set<Role> roles, String department, Long managerId) {
    }

    public record LoginRequest(@NotNull Long employeeId) {
    }

    public record LoginResponse(String token, OffsetDateTime expiresAt, DemoUser user) {
    }

    public record ActiveDelegation(Long id, Long delegatorId, String delegatorName, String toDate) {
    }

    public record Me(Long id, String empCode, String name, String email, Set<Role> roles, String department,
                     Long managerId, List<ActiveDelegation> actingFor) {
    }

    @GetMapping("/auth/demo-users")
    @Transactional(readOnly = true)
    public List<DemoUser> demoUsers() {
        requireDemo();
        return employees.findAll().stream().filter(Employee::isActive)
                .sorted(Comparator.comparing((Employee e) -> -approverRank(e)).thenComparing(Employee::getEmpCode))
                .map(this::demoUser).toList();
    }

    @PostMapping("/auth/demo-login")
    @Transactional(readOnly = true)
    public LoginResponse demoLogin(@Valid @RequestBody LoginRequest req, HttpServletRequest http) {
        requireDemo();
        if (!limiter.tryAcquire(http.getRemoteAddr())) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "RATE_LIMITED", "Too many login attempts, wait a minute");
        }
        Employee e = employees.findById(req.employeeId()).filter(Employee::isActive)
                .orElseThrow(() -> ApiException.notFound("User"));
        JwtService.Issued t = jwt.issue(e.getId(), e.getName(), e.roleSet());
        return new LoginResponse(t.token(), Ist.render(t.expiresAt()), demoUser(e));
    }

    @GetMapping("/me")
    @Transactional(readOnly = true)
    public Me me() {
        CurrentUser u = CurrentUser.get();
        Employee e = employees.findById(u.id()).orElseThrow(() -> ApiException.notFound("User"));
        List<ActiveDelegation> acting = delegations.findActiveForDelegate(u.id(), Ist.date(clock.instant())).stream()
                .map(d -> new ActiveDelegation(d.getId(), d.getDelegatorId(),
                        employees.findById(d.getDelegatorId()).map(Employee::getName).orElse(null),
                        d.getToDate().toString()))
                .toList();
        return new Me(e.getId(), e.getEmpCode(), e.getName(), e.getEmail(), e.roleSet(), deptCode(e),
                e.getManagerId(), acting);
    }

    private void requireDemo() {
        if (!demoEnabled) {
            throw ApiException.notFound("Endpoint");
        }
    }

    private DemoUser demoUser(Employee e) {
        return new DemoUser(e.getId(), e.getEmpCode(), e.getName(), e.roleSet(), deptCode(e), e.getManagerId());
    }

    private String deptCode(Employee e) {
        return e.getDepartmentId() == null ? null
                : departments.findById(e.getDepartmentId()).map(Department::getCode).orElse(null);
    }

    private static int approverRank(Employee e) {
        Set<Role> r = e.roleSet();
        return r.contains(Role.FINANCE_HEAD) ? 3 : r.contains(Role.AUDITOR) ? 2 : r.contains(Role.MANAGER) ? 1 : 0;
    }
}
