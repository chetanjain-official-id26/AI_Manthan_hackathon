package com.expenseflow.claim;

import com.expenseflow.claim.ClaimDtos.*;
import com.expenseflow.claim.ClaimQueryService.ClaimSort;
import com.expenseflow.common.error.ApiException;
import com.expenseflow.common.security.CurrentUser;
import com.expenseflow.common.time.Ist;
import jakarta.validation.Valid;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.UncheckedIOException;

@RestController
@RequestMapping("/api")
public class ClaimController {

    private final ClaimService service;
    private final ClaimQueryService query;
    private final ReceiptStorage storage;

    public ClaimController(ClaimService service, ClaimQueryService query, ReceiptStorage storage) {
        this.service = service;
        this.query = query;
        this.storage = storage;
    }

    @GetMapping("/claims")
    public PageView<ClaimSummary> list(@RequestParam(defaultValue = "false") boolean mine,
                                       @RequestParam(required = false) ClaimStatus status,
                                       @RequestParam(defaultValue = "0") int page,
                                       @RequestParam(defaultValue = "20") int size,
                                       @RequestParam(required = false) String sort) {
        return query.list(CurrentUser.get(), mine, status, page, size, ClaimSort.parse(sort));
    }

    @PostMapping("/claims")
    @ResponseStatus(HttpStatus.CREATED)
    public ClaimDetail create(@Valid @RequestBody CreateClaimRequest req) {
        CurrentUser u = CurrentUser.get();
        return query.detail(service.create(req.title(), u).getId(), u);
    }

    @GetMapping("/claims/{id}")
    public ClaimDetail get(@PathVariable Long id) {
        return query.detail(id, CurrentUser.get());
    }

    @PatchMapping("/claims/{id}")
    public ClaimDetail update(@PathVariable Long id, @Valid @RequestBody UpdateClaimRequest req) {
        CurrentUser u = CurrentUser.get();
        service.updateTitle(id, req.title(), req.version(), u);
        return query.detail(id, u);
    }

    @PostMapping("/claims/{id}/lines")
    @ResponseStatus(HttpStatus.CREATED)
    public ClaimDetail addLine(@PathVariable Long id, @Valid @RequestBody LineRequest req) {
        CurrentUser u = CurrentUser.get();
        service.addLine(id, req, u);
        return query.detail(id, u);
    }

    @PutMapping("/claims/{id}/lines/{lineId}")
    public ClaimDetail updateLine(@PathVariable Long id, @PathVariable Long lineId,
                                  @Valid @RequestBody LineRequest req) {
        CurrentUser u = CurrentUser.get();
        service.updateLine(id, lineId, req, u);
        return query.detail(id, u);
    }

    @DeleteMapping("/claims/{id}/lines/{lineId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteLine(@PathVariable Long id, @PathVariable Long lineId) {
        service.deleteLine(id, lineId, CurrentUser.get());
    }

    @PostMapping(value = "/claims/{id}/lines/{lineId}/receipt", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public ReceiptUploaded upload(@PathVariable Long id, @PathVariable Long lineId,
                                  @RequestParam("file") MultipartFile file) {
        if (file.getSize() > ReceiptStorage.MAX_BYTES) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "FILE_TOO_LARGE", "Receipts must be 5 MB or smaller");
        }
        try {
            Receipt r = service.uploadReceipt(id, lineId, file.getBytes(), file.getOriginalFilename(), CurrentUser.get());
            return new ReceiptUploaded(r.getId(), r.getSha256(), r.getContentType(), r.getSizeBytes(),
                    r.getOriginalName());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    @GetMapping("/receipts/{receiptId}")
    public ResponseEntity<byte[]> download(@PathVariable Long receiptId) {
        Receipt r = query.visibleReceipt(receiptId, CurrentUser.get());
        byte[] bytes = storage.load(r.getStorageKey());
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(r.getContentType()))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment().filename(r.getOriginalName()).build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .body(bytes);
    }

    @PostMapping("/claims/{id}/policy-preview")
    public PreviewView preview(@PathVariable Long id) {
        return query.preview(service.preview(id, CurrentUser.get()));
    }

    @PostMapping("/claims/{id}/submit")
    public ClaimDetail submit(@PathVariable Long id, @Valid @RequestBody VersionRequest req) {
        CurrentUser u = CurrentUser.get();
        service.submit(id, req.version(), u);
        return query.detail(id, u);
    }

    @PostMapping("/claims/{id}/copy")
    @ResponseStatus(HttpStatus.CREATED)
    public ClaimDetail copy(@PathVariable Long id) {
        CurrentUser u = CurrentUser.get();
        return query.detail(service.copyToDraft(id, u).getId(), u);
    }

    @PostMapping("/claims/{id}/comments")
    @ResponseStatus(HttpStatus.CREATED)
    public CommentView comment(@PathVariable Long id, @Valid @RequestBody CommentRequest req) {
        CurrentUser u = CurrentUser.get();
        ClaimComment c = service.comment(id, req.body(), u);
        return new CommentView(c.getId(), c.getAuthorId(), u.name(), c.getBody(), Ist.render(c.getCreatedAt()));
    }
}
