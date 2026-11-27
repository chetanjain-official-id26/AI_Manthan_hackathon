package com.expenseflow.claim;

import com.expenseflow.common.error.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Receipts on local disk (R18): MIME sniffed from magic bytes (PDF/JPEG/PNG only), stored under a
 * random UUID key, SHA-256 over raw bytes, original name sanitised.
 */
@Component
public class ReceiptStorage {

    public static final long MAX_BYTES = 5L * 1024 * 1024;
    private static final Pattern UNSAFE = Pattern.compile("[^A-Za-z0-9._-]");
    private static final Pattern UUID_KEY = Pattern.compile("[0-9a-f-]{36}");

    private final Path root;

    public ReceiptStorage(@Value("${expenseflow.receipts.dir}") String dir) {
        this.root = Path.of(dir).toAbsolutePath().normalize();
        try {
            Files.createDirectories(root);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot create receipts dir " + root, e);
        }
    }

    public record Stored(String storageKey, String contentType, long size, String sha256) {
    }

    public Stored store(byte[] bytes) {
        if (bytes.length == 0) {
            throw ApiException.unprocessable("EMPTY_FILE", "The file is empty");
        }
        if (bytes.length > MAX_BYTES) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "FILE_TOO_LARGE", "Receipts must be 5 MB or smaller");
        }
        String type = sniff(bytes);
        if (type == null) {
            throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_FILE_TYPE",
                    "Only PDF, JPEG and PNG receipts are accepted");
        }
        String key = UUID.randomUUID().toString();
        try {
            Files.write(root.resolve(key), bytes);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot store receipt", e);
        }
        return new Stored(key, type, bytes.length, sha256(bytes));
    }

    public byte[] load(String storageKey) {
        if (!UUID_KEY.matcher(storageKey).matches()) {
            throw ApiException.notFound("Receipt");
        }
        Path p = root.resolve(storageKey).normalize();
        if (!p.startsWith(root) || !Files.exists(p)) {
            throw ApiException.notFound("Receipt");
        }
        try {
            return Files.readAllBytes(p);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Content type from magic bytes; the client's declared type and file name are ignored. */
    public static String sniff(byte[] b) {
        if (b.length >= 4 && b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F') {
            return "application/pdf";
        }
        if (b.length >= 3 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) {
            return "image/jpeg";
        }
        if (b.length >= 8 && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G'
                && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A) {
            return "image/png";
        }
        return null;
    }

    /** Strips any path and unsafe characters: "../../x.png" becomes "x.png". */
    public static String sanitizeName(String original) {
        if (original == null || original.isBlank()) {
            return "receipt";
        }
        String base = original.replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1);
        base = UNSAFE.matcher(base).replaceAll("_");
        while (base.startsWith(".")) {
            base = base.substring(1);
        }
        if (base.isBlank()) {
            base = "receipt";
        }
        return base.length() > 100 ? base.substring(base.length() - 100) : base;
    }

    public static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
