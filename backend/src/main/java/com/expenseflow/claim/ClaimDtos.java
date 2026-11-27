package com.expenseflow.claim;

import com.expenseflow.approval.StepStatus;
import com.expenseflow.policy.Outcome;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.data.domain.Page;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

/**
 * Request DTOs whitelist editable fields only. status, employeeId, total and version source are never
 * bound from the client; unknown JSON fields are rejected with 400 (R11).
 */
public final class ClaimDtos {
    private ClaimDtos() {
    }

    // ------------------------------------------------------------------ requests

    public record CreateClaimRequest(@NotBlank @Size(max = 200) String title) {
    }

    public record UpdateClaimRequest(@NotBlank @Size(max = 200) String title, @NotNull Integer version) {
    }

    public record LineRequest(
            @NotNull Category category,
            @NotNull @DecimalMin(value = "0.01", message = "must be greater than 0")
            @Digits(integer = 12, fraction = 2) BigDecimal amount,
            @NotNull LocalDate expenseDate,
            @NotBlank @Size(max = 160) String vendor,
            @Size(max = 80) String city,
            @NotNull CityTier cityTier,
            @Min(1) @Max(365) Integer nights,
            @Size(max = 500) String description,
            Integer version) {
    }

    public record VersionRequest(@NotNull Integer version) {
    }

    public record ApproveRequest(@NotNull Integer version, @Size(max = 1000) String note) {
    }

    public record RejectRequest(@NotNull Integer version, @Size(max = 1000) String reason) {
    }

    public record SendBackRequest(@NotNull Integer version, @Size(max = 1000) String comment) {
    }

    public record CommentRequest(@NotBlank @Size(max = 2000) String body) {
    }

    public record ReassignRequest(@NotNull Long assigneeId, @Size(max = 300) String reason) {
    }

    // ------------------------------------------------------------------ responses

    public record ClaimSummary(Long id, String claimNo, String title, ClaimStatus status, BigDecimal totalAmount,
                               Long employeeId, String employeeName, boolean sampleAudit, boolean splitSuspect,
                               Outcome policyOutcome, int cycleNo, OffsetDateTime submittedAt,
                               OffsetDateTime approvedAt, OffsetDateTime createdAt, int version) {
    }

    public record ReceiptView(Long id, String originalName, String contentType, long sizeBytes, String sha256) {
    }

    /** matchClaimId / matchClaimNo identify the claim holding relatedLineId, only when the caller may see it. */
    public record ResultView(String ruleCode, int ruleVersion, Outcome outcome, String flag, String reason,
                             Long relatedLineId, Long matchClaimId, String matchClaimNo) {
    }

    public record LineView(Long id, Category category, BigDecimal amount, LocalDate expenseDate, String vendor,
                           String city, CityTier cityTier, Integer nights, String description, Outcome lineOutcome,
                           ReceiptView receipt, List<ResultView> policyResults) {
    }

    public record StepView(Long id, int seq, String level, Long assigneeId, String assigneeName, String assigneeRole,
                           StepStatus status, Long actedBy, String actedByName, Long onBehalfOf,
                           String onBehalfOfName, OffsetDateTime activatedAt, OffsetDateTime actedAt, String note,
                           int cycleNo) {
    }

    public record CommentView(Long id, Long authorId, String authorName, String body, OffsetDateTime createdAt) {
    }

    public record Permissions(boolean canEdit, boolean canSubmit, boolean canApprove, Long actingOnBehalfOf,
                              boolean canCopy) {
    }

    public record ClaimDetail(ClaimSummary claim, List<LineView> lines, List<StepView> steps,
                              List<CommentView> comments, Permissions permissions) {
    }

    public record LinePreview(Long lineId, Outcome outcome, List<ResultView> results) {
    }

    public record PreviewView(Outcome claimOutcome, List<LinePreview> lines) {
    }

    public record ReceiptUploaded(Long receiptId, String sha256, String contentType, long sizeBytes,
                                  String originalName) {
    }

    public record PageView<T>(List<T> content, int page, int size, long totalElements, int totalPages) {
        public static <T> PageView<T> of(Page<T> p) {
            return new PageView<>(p.getContent(), p.getNumber(), p.getSize(), p.getTotalElements(), p.getTotalPages());
        }
    }
}
