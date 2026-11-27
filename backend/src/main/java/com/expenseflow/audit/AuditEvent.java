package com.expenseflow.audit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.ColumnTransformer;
import org.hibernate.annotations.Immutable;

import java.time.Instant;

/** Append-only (BR-24). Hibernate never updates it, and a DB trigger rejects UPDATE/DELETE. */
@Entity
@Immutable
@Table(name = "audit_event")
@Getter
@Setter
@NoArgsConstructor
public class AuditEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "entity_type", nullable = false)
    private String entityType;

    @Column(name = "entity_id")
    private Long entityId;

    @Column(name = "claim_id")
    private Long claimId;

    @Column(nullable = false)
    private String action;

    @Column(name = "actor_id")
    private Long actorId;

    @Column(name = "on_behalf_of_id")
    private Long onBehalfOfId;

    @Column(columnDefinition = "jsonb")
    @ColumnTransformer(write = "?::jsonb")
    private String before;

    @Column(columnDefinition = "jsonb")
    @ColumnTransformer(write = "?::jsonb")
    private String after;

    private String ip;

    @Column(name = "request_id")
    private String requestId;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
}
