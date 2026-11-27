package com.expenseflow.payout;

import com.expenseflow.payout.BankCsvWriter.Row;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BankCsvWriterTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 27);

    List<Row> rows() {
        // deliberately unsorted: the writer orders D rows by employee code
        return List.of(
                new Row("EMP0103", "Meera Iyer", "XXXXXX1180", "SYNB0000789", new BigDecimal("5000.00"), List.of("CLM-2026-0120")),
                new Row("EMP0042", "Ananya Rao", "XXXXXX4521", "SYNB0000123", new BigDecimal("18250.00"),
                        List.of("CLM-2026-0107", "CLM-2026-0101")),
                new Row("EMP0077", "Rohit Verma", "XXXXXX9033", "SYNB0000456", new BigDecimal("25000.00"), List.of("CLM-2026-0115")));
    }

    @Test
    @DisplayName("TC-PAY-02 golden file: byte-for-byte equal, name EXPF_20261127_12.csv, trailer = header = Σ D rows")
    void golden() throws Exception {
        byte[] actual = BankCsvWriter.write(12, DAY, new BigDecimal("48250.00"), rows());
        try (InputStream in = getClass().getResourceAsStream("/golden/EXPF_20261127_12.csv")) {
            byte[] expected = in.readAllBytes();
            assertThat(new String(actual, StandardCharsets.UTF_8)).isEqualTo(new String(expected, StandardCharsets.UTF_8));
            assertThat(actual).isEqualTo(expected);
        }
        assertThat(BankCsvWriter.fileName(DAY, 12)).isEqualTo("EXPF_20261127_12.csv");
        assertThat(actual[0]).isEqualTo((byte) 'H'); // no BOM
        assertThat(new String(actual, StandardCharsets.UTF_8)).doesNotContain("\r");
    }

    @Test
    @DisplayName("Re-exporting gives an identical file")
    void deterministic() {
        assertThat(BankCsvWriter.write(12, DAY, new BigDecimal("48250.00"), rows()))
                .isEqualTo(BankCsvWriter.write(12, DAY, new BigDecimal("48250.00"), rows().reversed()));
    }

    @Test
    @DisplayName("The writer refuses to stream when the control total does not match")
    void controlTotal() {
        assertThatThrownBy(() -> BankCsvWriter.write(12, DAY, new BigDecimal("48250.01"), rows()))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("control total");
    }

    @Test
    @DisplayName("TC-PAY-05 CSV injection: '=HYPERLINK(..)' is written as \"'=HYPERLINK(..)\" (R19); commas are quoted")
    void injection() {
        String csv = new String(BankCsvWriter.write(1, DAY, new BigDecimal("10.00"), List.of(
                new Row("EMP1", "=HYPERLINK(\"http://x\",\"y\")", "+123", "@SUM", new BigDecimal("10.00"), List.of("C1")))),
                StandardCharsets.UTF_8);
        assertThat(csv).contains("\"'=HYPERLINK(\"\"http://x\"\",\"\"y\"\")\"");
        assertThat(csv).contains(",'+123,'@SUM,");
        assertThat(BankCsvWriter.field("-5")).isEqualTo("'-5");
        assertThat(BankCsvWriter.field("Rao, Ananya")).isEqualTo("\"Rao, Ananya\"");
        assertThat(BankCsvWriter.field("plain")).isEqualTo("plain");
    }
}
