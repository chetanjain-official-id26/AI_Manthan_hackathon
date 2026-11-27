package com.expenseflow.common.security;

import java.util.Arrays;
import java.util.EnumSet;
import java.util.Set;
import java.util.stream.Collectors;

public enum Role {
    EMPLOYEE, MANAGER, AUDITOR, FINANCE_HEAD;

    public static Set<Role> parse(String csv) {
        if (csv == null || csv.isBlank()) {
            return EnumSet.of(EMPLOYEE);
        }
        Set<Role> roles = Arrays.stream(csv.split(","))
                .map(String::trim).filter(s -> !s.isEmpty())
                .map(Role::valueOf)
                .collect(Collectors.toCollection(() -> EnumSet.noneOf(Role.class)));
        roles.add(EMPLOYEE); // every user can file their own claims
        return roles;
    }

    public static String format(Set<Role> roles) {
        return roles.stream().map(Enum::name).sorted().collect(Collectors.joining(","));
    }
}
