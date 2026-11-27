package com.expenseflow.claim;

import com.expenseflow.policy.Outcome;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;

@Entity
@Table(name = "claim_line")
@Getter
@Setter
@NoArgsConstructor
public class ClaimLine {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "claim_id")
    private Claim claim;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Category category;

    @Column(nullable = false)
    private BigDecimal amount;

    @Column(name = "expense_date", nullable = false)
    private LocalDate expenseDate;

    @Column(nullable = false)
    private String vendor;

    @Column(name = "vendor_norm", nullable = false)
    private String vendorNorm;

    private String city;

    @Enumerated(EnumType.STRING)
    @Column(name = "city_tier", nullable = false)
    private CityTier cityTier;

    private Integer nights;

    private String description;

    @Enumerated(EnumType.STRING)
    @Column(name = "line_outcome")
    private Outcome lineOutcome;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
}
