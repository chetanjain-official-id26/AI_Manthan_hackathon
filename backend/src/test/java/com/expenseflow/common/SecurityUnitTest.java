package com.expenseflow.common;

import com.expenseflow.claim.ReceiptStorage;
import com.expenseflow.common.security.JwtService;
import com.expenseflow.common.security.Role;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SecurityUnitTest {

    @Test
    @DisplayName("TC-SEC-14 a JWT secret shorter than 32 bytes stops the app from starting (R20)")
    void shortSecret() {
        assertThatThrownBy(() -> new JwtService("too-short", 60))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("JWT secret too short");
        assertThatThrownBy(() -> new JwtService("", 60)).isInstanceOf(IllegalStateException.class);
        JwtService ok = new JwtService("x".repeat(32), 60);
        String token = ok.issue(7L, "Seven", Set.of(Role.EMPLOYEE, Role.MANAGER)).token();
        var jwt = ok.decoder().decode(token);
        assertThat(jwt.getSubject()).isEqualTo("7");
        assertThat(jwt.getClaimAsStringList("roles")).containsExactly("EMPLOYEE", "MANAGER");
    }

    @Test
    @DisplayName("R18 MIME is sniffed from magic bytes, never from the name or declared type")
    void sniff() {
        assertThat(ReceiptStorage.sniff("%PDF-1.7".getBytes(StandardCharsets.US_ASCII))).isEqualTo("application/pdf");
        assertThat(ReceiptStorage.sniff(new byte[]{(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, 0})).isEqualTo("image/jpeg");
        assertThat(ReceiptStorage.sniff(new byte[]{(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A})).isEqualTo("image/png");
        assertThat(ReceiptStorage.sniff("<svg onload=alert(1)>".getBytes(StandardCharsets.UTF_8))).isNull();
        assertThat(ReceiptStorage.sniff("MZ\u0090\u0000".getBytes(StandardCharsets.ISO_8859_1))).isNull();
    }

    @Test
    @DisplayName("R18 file names are sanitised: no paths, no odd characters")
    void sanitize() {
        assertThat(ReceiptStorage.sanitizeName("../../x.png")).isEqualTo("x.png");
        assertThat(ReceiptStorage.sanitizeName("..\\..\\windows\\evil.pdf")).isEqualTo("evil.pdf");
        assertThat(ReceiptStorage.sanitizeName("my bill (1).jpg")).isEqualTo("my_bill__1_.jpg");
        assertThat(ReceiptStorage.sanitizeName(".htaccess")).isEqualTo("htaccess");
        assertThat(ReceiptStorage.sanitizeName(null)).isEqualTo("receipt");
    }

    @Test
    @DisplayName("Receipt storage keys are UUIDs; path traversal in a key is treated as not found")
    void storageKeys(@TempDir Path dir) {
        ReceiptStorage s = new ReceiptStorage(dir.toString());
        byte[] pdf = "%PDF-1.4 test".getBytes(StandardCharsets.US_ASCII);
        var stored = s.store(pdf);
        assertThat(stored.storageKey()).matches("[0-9a-f-]{36}");
        assertThat(s.load(stored.storageKey())).isEqualTo(pdf);
        assertThat(stored.sha256()).isEqualTo(ReceiptStorage.sha256(pdf));
        assertThatThrownBy(() -> s.load("../../etc/passwd")).hasMessageContaining("not found");
    }

    @Test
    @DisplayName("Money helpers keep two decimals and compare by value")
    void money() {
        assertThat(Money.gt(Money.of("1500.01"), Money.of("1500.00"))).isTrue();
        assertThat(Money.gt(new java.math.BigDecimal("1500.0"), Money.of("1500.00"))).isFalse();
        assertThat(Money.plain(new java.math.BigDecimal("5"))).isEqualTo("5.00");
    }
}
