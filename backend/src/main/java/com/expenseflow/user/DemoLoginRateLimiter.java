package com.expenseflow.user;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Sliding one-minute window per client IP (LLD §11, TC-SEC-16). */
@Component
public class DemoLoginRateLimiter {

    private final int maxPerMinute;
    private final Map<String, Deque<Long>> hits = new ConcurrentHashMap<>();

    public DemoLoginRateLimiter(@Value("${expenseflow.demo-login.max-per-minute:10}") int maxPerMinute) {
        this.maxPerMinute = maxPerMinute;
    }

    public boolean tryAcquire(String ip) {
        long now = System.currentTimeMillis();
        Deque<Long> q = hits.computeIfAbsent(ip, k -> new ArrayDeque<>());
        synchronized (q) {
            while (!q.isEmpty() && now - q.peekFirst() > 60_000) {
                q.pollFirst();
            }
            if (q.size() >= maxPerMinute) {
                return false;
            }
            q.addLast(now);
            return true;
        }
    }

    public void reset() {
        hits.clear();
    }
}
