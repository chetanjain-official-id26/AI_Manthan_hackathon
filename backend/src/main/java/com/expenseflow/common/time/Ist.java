package com.expenseflow.common.time;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;

/** All business dates and rendering are in IST (CLAUDE.md rule 6). */
public final class Ist {
    public static final ZoneId ZONE = ZoneId.of("Asia/Kolkata");

    private Ist() {
    }

    public static OffsetDateTime render(Instant instant) {
        return instant == null ? null : instant.atZone(ZONE).toOffsetDateTime();
    }

    public static LocalDate date(Instant instant) {
        return instant.atZone(ZONE).toLocalDate();
    }

    public static Instant startOfDay(LocalDate date) {
        return date.atStartOfDay(ZONE).toInstant();
    }
}
