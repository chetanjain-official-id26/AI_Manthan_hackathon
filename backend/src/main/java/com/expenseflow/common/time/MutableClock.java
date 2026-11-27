package com.expenseflow.common.time;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Clock injected everywhere instead of {@code Instant.now()}. In production it follows the system
 * clock; the seed job and tests can pin it to a point in time.
 */
public class MutableClock extends Clock {

    private final AtomicReference<Instant> fixed = new AtomicReference<>();
    private final ZoneId zone;

    public MutableClock(ZoneId zone) {
        this.zone = zone;
    }

    public void set(Instant instant) {
        fixed.set(instant);
    }

    public void advance(Duration duration) {
        fixed.updateAndGet(i -> (i == null ? Instant.now() : i).plus(duration));
    }

    public void reset() {
        fixed.set(null);
    }

    @Override
    public ZoneId getZone() {
        return zone;
    }

    @Override
    public Clock withZone(ZoneId zone) {
        MutableClock c = new MutableClock(zone);
        c.fixed.set(fixed.get());
        return c;
    }

    @Override
    public Instant instant() {
        Instant f = fixed.get();
        return f != null ? f : Instant.now();
    }
}
