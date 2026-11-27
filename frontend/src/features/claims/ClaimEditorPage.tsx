import { useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Paperclip, Pencil, Plus, Send } from 'lucide-react';
import { claimsApi } from '@/api/claims';
import { ApiError, errorMessage } from '@/api/client';
import { qk } from '@/api/keys';
import type { ClaimDetail, ClaimLine, LineInput } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { StatusChip } from '@/components/ui/Chips';
import { Banner, ConflictBanner, ErrorBanner, Money, SkeletonDetail } from '@/components/ui/Display';
import { Field, Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ClaimNotFound } from '@/components/layout/NotFound';
import { useMe } from '@/features/auth/AuthContext';
import { useDebounce, useIsDesktop } from '@/hooks';
import { tierLabel } from '@/utils/cities';
import { CATEGORY_LABEL, STATUS_LABEL } from '@/utils/labels';
import { sumMoney } from '@/utils/money';
import { cn } from '@/utils/misc';
import { formatISTDate } from '@/utils/time';
import { LineForm } from './LineForm';
import { OutcomeSymbol, PolicyReasons } from './LinePolicyView';
import { isEditable, linePolicies, lineReceiptId, worst, type LinePolicy } from './policy';
import { ReceiptViewer } from './ReceiptViewer';

type Editing = { mode: 'new' } | { mode: 'edit'; lineId: number } | null;

export default function ClaimEditorPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
  const me = useMe();

  const q = useQuery({
    queryKey: qk.claim(id),
    queryFn: () => claimsApi.get(id),
    enabled: Number.isFinite(id) && id > 0,
  });

  if (!Number.isFinite(id) || id <= 0) return <ClaimNotFound />;
  if (q.isPending) return <SkeletonDetail />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.isNotFound) return <ClaimNotFound />;
    return <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />;
  }
  const claim = q.data;
  if (claim.employeeId !== me.id || !isEditable(claim)) return <Navigate to={`/claims/${claim.id}`} replace />;
  return <Editor key={claim.id} claim={claim} onRefresh={() => void q.refetch()} />;
}

function Editor({ claim, onRefresh }: { claim: ClaimDetail; onRefresh: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const desktop = useIsDesktop();

  const [title, setTitle] = useState(claim.title);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(claim.lines.length === 0 ? { mode: 'new' } : null);
  const [lineErrors, setLineErrors] = useState<{ fields: Record<string, string>; general: string | null }>({ fields: {}, general: null });
  const [confirmDelete, setConfirmDelete] = useState<ClaimLine | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: qk.claim(claim.id) });

  // ---------- live policy preview (debounced 500 ms after line changes) ----------
  const signature = JSON.stringify(
    claim.lines.map((l) => [l.id, String(l.amount), l.category, l.expenseDate, l.vendor, l.cityTier, l.nights, lineReceiptId(l)]),
  );
  const debouncedSig = useDebounce(signature, 500);
  const preview = useQuery({
    queryKey: [...qk.preview(claim.id), debouncedSig],
    queryFn: ({ signal }) => claimsApi.policyPreview(claim.id, signal),
    enabled: claim.lines.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: false,
  });
  const checking = signature !== debouncedSig || preview.isFetching;
  const policies = useMemo(() => linePolicies(claim, preview.data), [claim, preview.data]);
  const claimOutcome = preview.data?.claimOutcome ?? worst([...policies.values()].map((p) => p.outcome));
  const rejectCount = [...policies.values()].filter((p) => p.outcome === 'AUTO_REJECT').length;
  const routeCount = [...policies.values()].filter((p) => p.outcome === 'ROUTE').length;
  const total = sumMoney(claim.lines.map((l) => l.amount));

  // ---------- mutations ----------
  const handleError = (e: unknown, setter?: (m: string) => void) => {
    if (e instanceof ApiError && e.isConflict) {
      setConflict(true);
      return;
    }
    if (e instanceof ApiError && e.isNotFound) {
      toast.error('This claim no longer exists.');
      navigate('/claims');
      return;
    }
    setter?.(errorMessage(e));
  };

  const saveLine = useMutation({
    mutationFn: async ({ input, file, lineId }: { input: LineInput; file: File | null; lineId?: number }) => {
      const saved = lineId ? await claimsApi.updateLine(claim.id, lineId, input) : await claimsApi.addLine(claim.id, input);
      if (file) {
        try {
          await claimsApi.uploadReceipt(claim.id, saved.id, file);
        } catch (e) {
          throw new ReceiptUploadError(saved.id, e);
        }
      }
      return saved;
    },
    onSuccess: async (_saved, vars) => {
      setLineErrors({ fields: {}, general: null });
      setEditing(null);
      toast.success(vars.lineId ? 'Line updated' : 'Line added');
      await invalidate();
    },
    onError: async (e) => {
      if (e instanceof ReceiptUploadError) {
        await invalidate();
        setEditing({ mode: 'edit', lineId: e.lineId });
        const inner = e.cause;
        const msg =
          inner instanceof ApiError && inner.status === 413
            ? 'The file is larger than 5 MB.'
            : inner instanceof ApiError && inner.status === 415
              ? 'Only PDF, JPG or PNG files are accepted.'
              : errorMessage(inner);
        setLineErrors({ fields: { file: `Line saved, but the receipt upload failed: ${msg}` }, general: null });
        return;
      }
      if (e instanceof ApiError && e.isValidation) {
        setLineErrors({ fields: e.fieldErrors, general: Object.keys(e.fieldErrors).length ? null : errorMessage(e) });
        return;
      }
      handleError(e, (m) => setLineErrors({ fields: {}, general: m }));
    },
  });

  const deleteLine = useMutation({
    mutationFn: (lineId: number) => claimsApi.deleteLine(claim.id, lineId),
    onSuccess: async () => {
      setConfirmDelete(null);
      setEditing(null);
      toast.success('Line removed');
      await invalidate();
    },
    onError: (e) => {
      setConfirmDelete(null);
      handleError(e, (m) => toast.error(m));
    },
  });

  const saveTitle = useMutation({
    mutationFn: () =>
      claimsApi.update(claim.id, title.trim(), (qc.getQueryData<ClaimDetail>(qk.claim(claim.id)) ?? claim).version),
    onSuccess: (c) => {
      qc.setQueryData(qk.claim(claim.id), (old: ClaimDetail | undefined) => (old ? { ...old, title: c.title, version: c.version } : old));
      void qc.invalidateQueries({ queryKey: qk.claims });
    },
  });

  /** In-flight blur save of the title, so submit can wait for it instead of racing it (both would PATCH with the same version → 409). */
  const titleSaveInFlight = useRef<Promise<unknown> | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      // Clicking Submit blurs the title field, which starts a title save: let it finish, then use the newest version.
      if (titleSaveInFlight.current) await titleSaveInFlight.current;
      const latest = qc.getQueryData<ClaimDetail>(qk.claim(claim.id)) ?? claim;
      let version = latest.version;
      if (title.trim() !== latest.title) {
        const updated = await claimsApi.update(claim.id, title.trim(), version);
        version = updated.version;
      }
      return claimsApi.submit(claim.id, version);
    },
    onSuccess: (res) => {
      setConfirmSubmit(false);
      void qc.invalidateQueries({ queryKey: qk.claims });
      qc.setQueryData(qk.claim(claim.id), res);
      toast.success(`Submitted · ${STATUS_LABEL[res.status] ?? res.status}`);
      navigate(`/claims/${claim.id}`, { replace: true });
    },
    onError: (e) => {
      setConfirmSubmit(false);
      handleError(e, setSubmitError);
    },
  });

  async function onSaveDraft() {
    if (!title.trim()) {
      setTitleError('Title is required.');
      return;
    }
    setTitleError(null);
    // Clicking the button blurs the title field, which may already be saving the title.
    if (titleSaveInFlight.current) await titleSaveInFlight.current;
    const latest = qc.getQueryData<ClaimDetail>(qk.claim(claim.id)) ?? claim;
    if (title.trim() !== latest.title) {
      try {
        await saveTitle.mutateAsync();
      } catch (e) {
        handleError(e, setTitleError);
        return;
      }
    }
    toast.success('Draft saved');
    navigate('/claims');
  }

  function onSubmitClick() {
    setSubmitError(null);
    if (!title.trim()) {
      setTitleError('Title is required.');
      return;
    }
    if (claim.lines.length === 0) return;
    if (rejectCount > 0) setConfirmSubmit(true);
    else submit.mutate();
  }

  // ---------- derived ----------
  const sentBackNote = useMemo(() => {
    const steps = [...claim.approvalSteps].filter((s) => s.status === 'SENT_BACK').sort((a, b) => (b.actedAt ?? '').localeCompare(a.actedAt ?? ''));
    const s = steps[0];
    if (s?.note) return { by: s.actedByName ?? s.assigneeName ?? 'Approver', note: s.note };
    const c = [...claim.comments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find((x) => x.authorId !== claim.employeeId);
    return c ? { by: c.authorName ?? 'Approver', note: c.body } : null;
  }, [claim]);

  const editingLine = editing?.mode === 'edit' ? claim.lines.find((l) => l.id === editing.lineId) ?? null : null;
  const selectedIndex = editingLine ? claim.lines.findIndex((l) => l.id === editingLine.id) : 0;
  const receipts = claim.lines.map((l, i) => ({
    lineId: l.id,
    receiptId: lineReceiptId(l),
    label: `Line ${i + 1} · ${CATEGORY_LABEL[l.category]} · ${l.vendor}`,
  }));

  const openEditor = (e: Editing) => {
    setLineErrors({ fields: {}, general: null });
    setEditing(e);
  };

  const form = editing && (
    <LineForm
      key={editing.mode === 'edit' ? `edit-${editing.lineId}` : 'new'}
      line={editingLine}
      existingReceiptName={editingLine?.receipt?.originalName ?? (editingLine && lineReceiptId(editingLine) ? 'receipt' : null)}
      serverErrors={lineErrors.fields}
      generalError={lineErrors.general}
      saving={saveLine.isPending}
      onSave={(input, file) => saveLine.mutate({ input, file, lineId: editingLine?.id })}
      onCancel={() => setEditing(null)}
      onDelete={editingLine ? () => setConfirmDelete(editingLine) : undefined}
    />
  );

  return (
    <div className="pb-24 lg:pb-0">
      <Link to="/claims" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-700 hover:text-slate-900" data-testid="back-to-claims">
        <ArrowLeft className="h-4 w-4" aria-hidden /> My claims
      </Link>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-xl font-bold text-slate-900">{claim.lines.length ? 'Edit claim' : 'New claim'}</h1>
          <span className="text-sm text-slate-600">{claim.claimNo}</span>
        </div>
        <StatusChip status={claim.status} />
      </div>

      <div className="space-y-3">
        {conflict && (
          <ConflictBanner
            onRefresh={() => {
              setConflict(false);
              onRefresh();
            }}
          />
        )}
        {claim.status === 'SENT_BACK' && (
          <Banner tone="orange" title="Sent back for changes" testId="sent-back-banner">
            {sentBackNote ? (
              <>
                <span className="font-medium">{sentBackNote.by}:</span> “{sentBackNote.note}”
              </>
            ) : (
              'An approver asked you to make changes. Edit the lines and resubmit.'
            )}
            <p className="mt-1 text-xs">Resubmitting re-runs the policy check and restarts approvals from the manager.</p>
          </Banner>
        )}
        {submitError && (
          <Banner tone="error" title="Could not submit" testId="submit-error">
            {submitError}
          </Banner>
        )}
      </div>

      <div className={cn('mt-4 grid gap-4', desktop && 'grid-cols-[minmax(0,1fr)_420px]')}>
        {/* ---- left: title + lines ---- */}
        <div className="min-w-0 space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <Field label="Title" required error={titleError} testId="claim-title">
              {(p) => (
                <Input
                  {...p}
                  maxLength={120}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setTitleError(null);
                  }}
                  onBlur={() => {
                    if (title.trim() && title.trim() !== claim.title) {
                      const p = saveTitle
                        .mutateAsync()
                        .catch((e: unknown) => handleError(e, setTitleError))
                        .finally(() => {
                          if (titleSaveInFlight.current === p) titleSaveInFlight.current = null;
                        });
                      titleSaveInFlight.current = p;
                    }
                  }}
                  data-testid="claim-title"
                />
              )}
            </Field>
          </section>

          <section className="rounded-xl border border-slate-200/80 bg-white shadow-xs" aria-labelledby="lines-heading">
            <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <h2 id="lines-heading" className="text-sm font-semibold text-slate-900">
                Lines ({claim.lines.length})
              </h2>
              <span className="flex items-center gap-1 text-xs text-slate-600" aria-live="polite" data-testid="policy-checking">
                {checking && claim.lines.length > 0 ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Checking policy…
                  </>
                ) : preview.isError ? (
                  <span className="text-red-700">Policy check unavailable</span>
                ) : claim.lines.length > 0 ? (
                  'Policy checked'
                ) : null}
              </span>
            </header>

            {claim.lines.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-600" data-testid="no-lines">
                No lines yet. Add your first expense.
              </p>
            ) : desktop ? (
              <LinesTable
                lines={claim.lines}
                policies={policies}
                selectedId={editingLine?.id ?? null}
                onSelect={(l) => openEditor({ mode: 'edit', lineId: l.id })}
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {claim.lines.map((l, i) => (
                  <LineCard key={l.id} line={l} index={i} policy={policies.get(l.id)} onOpen={() => openEditor({ mode: 'edit', lineId: l.id })} />
                ))}
              </ul>
            )}

            <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
              <Button
                icon={<Plus className="h-4 w-4" aria-hidden />}
                onClick={() => openEditor({ mode: 'new' })}
                testId="add-line"
              >
                Add line
              </Button>
              <p className="text-sm">
                Total <Money value={total} strong className="ml-1 text-base" />
              </p>
            </div>
          </section>

          {claim.lines.length > 0 && (
            <p className="text-sm text-slate-700" data-testid="claim-outcome-summary">
              {claimOutcome === 'AUTO_REJECT'
                ? `✕ ${rejectCount} line${rejectCount > 1 ? 's' : ''} will be rejected, so the claim would be policy-rejected.`
                : claimOutcome === 'ROUTE'
                  ? `⚑ ${routeCount} line${routeCount > 1 ? 's need' : ' needs'} approval; the claim will go to your manager.`
                  : '✓ All lines pass policy.'}
            </p>
          )}

          {/* desktop action bar */}
          {desktop && (
            <div className="flex justify-end gap-2">
              <Button onClick={() => void onSaveDraft()} loading={saveTitle.isPending} testId="save-draft">
                Save draft
              </Button>
              <Button
                variant="primary"
                icon={<Send className="h-4 w-4" aria-hidden />}
                disabled={claim.lines.length === 0 || checking}
                loading={submit.isPending}
                onClick={onSubmitClick}
                testId="submit-claim"
              >
                {claim.status === 'SENT_BACK' ? 'Resubmit' : 'Submit'}
              </Button>
            </div>
          )}
        </div>

        {/* ---- right: editor panel + receipt preview (desktop) ---- */}
        {desktop && (
          <aside className="space-y-4">
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Line editor">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                {editing?.mode === 'edit' ? `Edit line ${selectedIndex + 1}` : editing ? 'New line' : 'Line editor'}
              </h2>
              {form ?? (
                <p className="text-sm text-slate-600">
                  Select a line to edit it, or choose <strong>Add line</strong>.
                </p>
              )}
            </section>
            {editingLine && lineReceiptId(editingLine) && (
              <ReceiptViewer receipts={receipts} index={selectedIndex} heightClass="h-72" testId="editor-receipt" />
            )}
          </aside>
        )}
      </div>

      {/* mobile: bottom-sheet editor */}
      {!desktop && (
        <Modal
          open={!!editing}
          onClose={() => setEditing(null)}
          title={editing?.mode === 'edit' ? `Edit line ${selectedIndex + 1}` : 'Add line'}
          variant="sheet"
          testId="line-sheet"
        >
          {form}
        </Modal>
      )}

      {/* mobile sticky action bar */}
      {!desktop && (
        <div className="fixed inset-x-0 bottom-14 z-20 flex gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] backdrop-blur md:bottom-0 md:left-[var(--sidebar-w)]">
          <Button className="flex-1" onClick={() => void onSaveDraft()} loading={saveTitle.isPending} testId="m-save-draft">
            Save draft
          </Button>
          <Button
            className="flex-1"
            variant="primary"
            icon={<Send className="h-4 w-4" aria-hidden />}
            disabled={claim.lines.length === 0 || checking}
            loading={submit.isPending}
            onClick={onSubmitClick}
            testId="m-submit-claim"
          >
            {claim.status === 'SENT_BACK' ? 'Resubmit' : 'Submit'}
          </Button>
        </div>
      )}

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Remove this line?"
        size="sm"
        testId="confirm-delete-line"
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)} testId="confirm-delete-cancel">
              Keep
            </Button>
            <Button
              variant="danger"
              loading={deleteLine.isPending}
              onClick={() => confirmDelete && deleteLine.mutate(confirmDelete.id)}
              testId="confirm-delete-ok"
            >
              Remove line
            </Button>
          </>
        }
      >
        {confirmDelete && (
          <p className="text-sm text-slate-700">
            {CATEGORY_LABEL[confirmDelete.category]} · {confirmDelete.vendor} · <Money value={confirmDelete.amount} /> will be removed from
            this draft.
          </p>
        )}
      </Modal>

      <Modal
        open={confirmSubmit}
        onClose={() => setConfirmSubmit(false)}
        title="Submit a claim that will be rejected?"
        size="sm"
        testId="confirm-submit"
        footer={
          <>
            <Button onClick={() => setConfirmSubmit(false)} testId="confirm-submit-cancel">
              Go back and fix
            </Button>
            <Button variant="danger" loading={submit.isPending} onClick={() => submit.mutate()} testId="confirm-submit-ok">
              Submit anyway
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-slate-700">
          <p>
            {rejectCount} line{rejectCount > 1 ? 's' : ''} will be rejected, so the claim will be <strong>policy-rejected</strong>. Continue?
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {claim.lines
              .filter((l) => policies.get(l.id)?.outcome === 'AUTO_REJECT')
              .map((l) => (
                <li key={l.id}>
                  {CATEGORY_LABEL[l.category]} · {l.vendor} · <Money value={l.amount} />
                  <PolicyReasons results={policies.get(l.id)?.results ?? []} compact />
                </li>
              ))}
          </ul>
        </div>
      </Modal>
    </div>
  );
}

class ReceiptUploadError extends Error {
  readonly lineId: number;
  override readonly cause: unknown;
  constructor(lineId: number, cause: unknown) {
    super('Receipt upload failed');
    this.lineId = lineId;
    this.cause = cause;
  }
}

function LinesTable({
  lines,
  policies,
  selectedId,
  onSelect,
}: {
  lines: ClaimLine[];
  policies: Map<number, LinePolicy>;
  selectedId: number | null;
  onSelect: (l: ClaimLine) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="lines-table">
        <thead className="ef-thead text-left font-semibold uppercase">
          <tr>
            <th scope="col" className="px-3 py-2">Category</th>
            <th scope="col" className="px-3 py-2">Date</th>
            <th scope="col" className="px-3 py-2">Vendor</th>
            <th scope="col" className="px-3 py-2 text-right">Amount</th>
            <th scope="col" className="px-3 py-2">Receipt</th>
            <th scope="col" className="px-3 py-2">Policy</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 [&>tr:hover]:bg-slate-50/80">
          {lines.map((l, i) => {
            const p = policies.get(l.id);
            return (
              <tr
                key={l.id}
                onClick={() => onSelect(l)}
                className={cn('cursor-pointer align-top hover:bg-slate-50', selectedId === l.id && 'bg-indigo-50')}
                data-testid={`line-row-${i}`}
              >
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-medium text-indigo-800 hover:underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(l);
                    }}
                    data-testid={`line-edit-${i}`}
                  >
                    <Pencil className="h-3 w-3" aria-hidden />
                    {CATEGORY_LABEL[l.category]}
                  </button>
                  {l.category === 'HOTEL' && (
                    <span className="block text-xs text-slate-600">
                      {l.nights} night{(l.nights ?? 0) > 1 ? 's' : ''} · {tierLabel(l.cityTier)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{formatISTDate(l.expenseDate)}</td>
                <td className="max-w-[12rem] px-3 py-2">
                  <span className="block truncate">{l.vendor}</span>
                  {l.city && <span className="block truncate text-xs text-slate-600">{l.city}</span>}
                </td>
                <td className="px-3 py-2 text-right">
                  <Money value={l.amount} />
                </td>
                <td className="px-3 py-2">
                  {lineReceiptId(l) ? (
                    <span className="inline-flex items-center gap-1 text-xs text-green-800" data-testid={`line-receipt-ok-${i}`}>
                      <Paperclip className="h-3 w-3" aria-hidden /> Attached
                    </span>
                  ) : (
                    <span className="text-xs text-slate-600">None</span>
                  )}
                </td>
                <td className="px-3 py-2" data-testid={`line-policy-${i}`}>
                  <div className="flex items-start gap-2">
                    <OutcomeSymbol policy={p} testId={`line-outcome-${i}`} />
                    <PolicyReasons results={p?.results ?? []} compact />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LineCard({ line, index, policy, onOpen }: { line: ClaimLine; index: number; policy?: LinePolicy; onOpen: () => void }) {
  const border =
    policy?.outcome === 'AUTO_REJECT' ? 'border-l-red-600' : policy?.outcome === 'ROUTE' ? 'border-l-amber-500' : policy?.outcome ? 'border-l-green-600' : 'border-l-slate-300';
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn('w-full border-l-4 px-4 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600', border)}
        data-testid={`line-card-${index}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase text-slate-600">Line {index + 1}</span>
          <OutcomeSymbol policy={policy} testId={`line-outcome-${index}`} />
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-slate-900">
            {CATEGORY_LABEL[line.category]} · {line.vendor}
          </span>
          <Money value={line.amount} strong />
        </div>
        <p className="mt-0.5 text-xs text-slate-600">
          {formatISTDate(line.expenseDate)}
          {line.category === 'HOTEL' && ` · ${line.nights} night${(line.nights ?? 0) > 1 ? 's' : ''} · ${tierLabel(line.cityTier)}`}
          {' · '}
          {lineReceiptId(line) ? 'receipt ✓' : 'no receipt'}
        </p>
        <div className="mt-1">
          <PolicyReasons results={policy?.results ?? []} compact />
        </div>
      </button>
    </li>
  );
}
