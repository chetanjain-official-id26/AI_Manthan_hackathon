package com.expenseflow.common.time;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.security.SecureRandom;
import java.util.Random;

import org.springframework.beans.factory.annotation.Value;

@Configuration
public class ClockConfig {

    @Bean
    public MutableClock clock() {
        return new MutableClock(Ist.ZONE);
    }

    /** BR-20 / R21: seedable in tests and demo, SecureRandom in production. */
    @Bean
    public Random sampleAuditRandom(@Value("${expenseflow.sample-audit.seed:}") String seed) {
        if (seed == null || seed.isBlank()) {
            return new SecureRandom();
        }
        return new Random(Long.parseLong(seed.trim()));
    }
}
