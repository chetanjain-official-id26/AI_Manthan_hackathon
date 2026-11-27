package com.expenseflow.policy.engine;

import java.util.Locale;
import java.util.regex.Pattern;

/** vendor_norm = lower(trim(collapse_spaces(remove_punctuation(vendor)))) — LLD §7.1. */
public final class VendorNormalizer {
    private static final Pattern PUNCT = Pattern.compile("[\\p{P}\\p{S}]");
    private static final Pattern SPACES = Pattern.compile("\\s+");

    private VendorNormalizer() {
    }

    public static String normalize(String vendor) {
        if (vendor == null) {
            return "";
        }
        String noPunct = PUNCT.matcher(vendor).replaceAll("");
        return SPACES.matcher(noPunct).replaceAll(" ").trim().toLowerCase(Locale.ROOT);
    }
}
