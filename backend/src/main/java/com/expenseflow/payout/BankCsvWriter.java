package com.expenseflow.payout;

import com.expenseflow.common.Money;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.List;

/**
 * Mock bank CSV (LLD §8). UTF-8 without BOM, '\n' line endings, comma separator, quoting only when
 * needed, 2-decimal amounts. Deterministic, so re-exporting gives an identical file.
 */
public final class BankCsvWriter {

    private static final DateTimeFormatter FILE_DATE = DateTimeFormatter.ofPattern("yyyyMMdd");

    private BankCsvWriter() {
    }

    /** One D row per employee; {@code claimNos} are joined with '|'. */
    public record Row(String empCode, String name, String bankAccount, String ifsc, BigDecimal amount,
                      List<String> claimNos) {
    }

    public static String fileName(LocalDate exportDate, long batchId) {
        return "EXPF_" + exportDate.format(FILE_DATE) + "_" + batchId + ".csv";
    }

    public static byte[] write(long batchId, LocalDate exportDate, BigDecimal expectedTotal, List<Row> rows) {
        List<Row> sorted = rows.stream().sorted(Comparator.comparing(Row::empCode)).toList();
        BigDecimal sum = sorted.stream().map(Row::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        if (sum.compareTo(expectedTotal) != 0) {
            throw new IllegalStateException("Payout CSV control total mismatch: rows " + sum + " vs batch "
                    + expectedTotal);
        }
        String total = Money.plain(sum);
        StringBuilder sb = new StringBuilder();
        line(sb, "H", "BATCH_ID", "DATE", "COUNT", "TOTAL");
        line(sb, "H", String.valueOf(batchId), exportDate.toString(), String.valueOf(sorted.size()), total);
        line(sb, "D", "EMP_ID", "NAME", "BANK_ACCOUNT", "IFSC", "AMOUNT", "CLAIM_IDS", "NARRATION");
        String narration = "EXPF B" + batchId + " reimbursement";
        for (Row r : sorted) {
            line(sb, "D", r.empCode(), r.name(), r.bankAccount(), r.ifsc(), Money.plain(r.amount()),
                    String.join("|", r.claimNos().stream().sorted().toList()), narration);
        }
        line(sb, "T", "CONTROL_TOTAL", total, "COUNT", String.valueOf(sorted.size()));
        return sb.toString().getBytes(StandardCharsets.UTF_8);
    }

    private static void line(StringBuilder sb, String... fields) {
        for (int i = 0; i < fields.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            sb.append(field(fields[i]));
        }
        sb.append('\n');
    }

    /** CSV-injection guard (R19), then RFC 4180 quoting when needed. */
    static String field(String raw) {
        String v = raw == null ? "" : raw;
        if (!v.isEmpty() && "=+-@".indexOf(v.charAt(0)) >= 0) {
            v = "'" + v;
        }
        if (v.indexOf(',') >= 0 || v.indexOf('"') >= 0 || v.indexOf('\n') >= 0 || v.indexOf('\r') >= 0) {
            v = '"' + v.replace("\"", "\"\"") + '"';
        }
        return v;
    }
}
