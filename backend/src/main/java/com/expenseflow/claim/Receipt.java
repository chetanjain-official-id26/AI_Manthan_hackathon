package com.expenseflow.claim;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;

/** Receipt metadata. The file is stored under a random UUID key; SHA-256 is over the raw bytes. */
@Entity
@Table(name = "receipt")
@Getter
@Setter
@NoArgsConstructor
public class Receipt {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "claim_line_id", nullable = false)
    private Long claimLineId;

    @Column(name = "storage_key", nullable = false)
    private String storageKey;

    @Column(name = "original_name", nullable = false)
    private String originalName;

    @Column(name = "content_type", nullable = false)
    private String contentType;

    @Column(name = "size_bytes", nullable = false)
    private long sizeBytes;

    @Column(nullable = false)
    private String sha256;

    @Column(name = "uploaded_by")
    private Long uploadedBy;

    @Column(name = "uploaded_at", nullable = false)
    private Instant uploadedAt;
}
