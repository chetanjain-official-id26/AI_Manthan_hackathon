package com.expenseflow;

import com.expenseflow.support.IntegrationTest;
import com.expenseflow.user.Employee;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class SmokeIT extends IntegrationTest {

    @Test
    @DisplayName("Context starts, Flyway migrates, health is UP and /me works with a JWT")
    void boots() throws Exception {
        assertThat(get("/actuator/health", null, 200).get("status").asText()).isEqualTo("UP");
        Employee e = emp("EMPLOYEE", null);
        assertThat(get("/api/me", token(e), 200).get("id").asLong()).isEqualTo(e.getId());
        get("/api/me", null, 401);
    }
}
