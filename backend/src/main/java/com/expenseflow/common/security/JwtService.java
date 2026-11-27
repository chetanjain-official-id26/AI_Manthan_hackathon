package com.expenseflow.common.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;

/** HS256 tokens. The app refuses to start with a secret shorter than 32 bytes (R20, TC-SEC-14). */
@Service
public class JwtService {

    public static final int MIN_SECRET_BYTES = 32;

    private final Duration ttl;
    private final JwtEncoder encoder;
    private final JwtDecoder decoder;

    public JwtService(@Value("${expenseflow.jwt.secret:}") String secret,
                      @Value("${expenseflow.jwt.ttl-minutes:60}") long ttlMinutes) {
        byte[] bytes = secret == null ? new byte[0] : secret.getBytes(StandardCharsets.UTF_8);
        if (bytes.length < MIN_SECRET_BYTES) {
            throw new IllegalStateException("JWT secret too short: set JWT_SECRET to at least "
                    + MIN_SECRET_BYTES + " bytes");
        }
        SecretKey key = new SecretKeySpec(bytes, "HmacSHA256");
        this.ttl = Duration.ofMinutes(ttlMinutes);
        this.encoder = NimbusJwtEncoder.withSecretKey(key).algorithm(MacAlgorithm.HS256).build();
        this.decoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build();
    }

    public record Issued(String token, Instant expiresAt) {
    }

    public Issued issue(Long employeeId, String name, Set<Role> roles) {
        // Real time on purpose: token validity must not follow a clock pinned by the seed job or tests.
        return issueAt(employeeId, name, roles, Instant.now());
    }

    public Issued issueAt(Long employeeId, String name, Set<Role> roles, Instant issuedAt) {
        Instant exp = issuedAt.plus(ttl);
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer("expenseflow")
                .subject(String.valueOf(employeeId))
                .issuedAt(issuedAt)
                .expiresAt(exp)
                .claim("name", name)
                .claim("roles", roles.stream().map(Enum::name).sorted().toList())
                .build();
        String token = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims))
                .getTokenValue();
        return new Issued(token, exp);
    }

    public JwtDecoder decoder() {
        return decoder;
    }
}
