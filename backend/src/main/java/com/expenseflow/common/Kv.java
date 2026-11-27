package com.expenseflow.common;

import java.util.LinkedHashMap;
import java.util.Map;

/** Ordered map builder that allows null values (unlike Map.of). Used for audit before/after. */
public final class Kv {
    private Kv() {
    }

    public static Map<String, Object> of(Object... kv) {
        if (kv.length % 2 != 0) {
            throw new IllegalArgumentException("key/value pairs expected");
        }
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) {
            m.put(String.valueOf(kv[i]), kv[i + 1]);
        }
        return m;
    }
}
