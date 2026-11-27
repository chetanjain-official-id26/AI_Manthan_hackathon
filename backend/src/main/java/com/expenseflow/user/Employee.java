package com.expenseflow.user;

import com.expenseflow.common.security.Role;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.Set;

/**
 * Hierarchy and roles are seed/admin data only. There is no endpoint that lets a user change their
 * own manager or roles (R13).
 */
@Entity
@Table(name = "employee")
@Getter
@Setter
@NoArgsConstructor
public class Employee {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "emp_code", nullable = false)
    private String empCode;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String email;

    @Column(name = "department_id")
    private Long departmentId;

    @Column(name = "manager_id")
    private Long managerId;

    @Column(nullable = false)
    private String roles;

    @Column(name = "bank_account_masked")
    private String bankAccountMasked;

    private String ifsc;

    private boolean active = true;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    public Set<Role> roleSet() {
        return Role.parse(roles);
    }

    public boolean hasRole(Role role) {
        return roleSet().contains(role);
    }
}
