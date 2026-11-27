package com.expenseflow.common.security;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

import java.util.EnumSet;
import java.util.List;
import java.util.Set;

/** The authenticated caller, derived server-side from the verified JWT (never from the request body). */
public record CurrentUser(Long id, String name, Set<Role> roles) {

    public boolean has(Role role) {
        return roles.contains(role);
    }

    public boolean seesAll() {
        return has(Role.AUDITOR) || has(Role.FINANCE_HEAD);
    }

    public static CurrentUser get() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth instanceof JwtAuthenticationToken token) {
            return fromJwt(token.getToken());
        }
        throw new IllegalStateException("No authenticated user");
    }

    public static CurrentUser fromJwt(Jwt jwt) {
        List<String> roles = jwt.getClaimAsStringList("roles");
        Set<Role> set = EnumSet.noneOf(Role.class);
        if (roles != null) {
            roles.forEach(r -> set.add(Role.valueOf(r)));
        }
        return new CurrentUser(Long.valueOf(jwt.getSubject()), jwt.getClaimAsString("name"), set);
    }
}
