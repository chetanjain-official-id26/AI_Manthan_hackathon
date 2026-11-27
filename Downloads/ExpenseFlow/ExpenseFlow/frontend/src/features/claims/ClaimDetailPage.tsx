import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Copy, Keyboard, MoreHorizontal, Pencil, RotateCcw, SkipForward, X } from 'lucide-react';
import { approvalsApi } from '@/api/approvals';
import { claimsApi } from '@/api/claims';
import { ApiError, errorMessage } from '@/api/client';
import { qk } from '@/api/keys';
import type { ClaimDetail, PolicyResult } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { FlagChip, OutcomeBadge, StatusChip } from '@/components/ui/Chips';
import { AgeBadge, Banner, ConflictBanner, ErrorBanner, Money, SkeletonDetail } from '@/components/ui/Display';
import { Field, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ClaimNotFound } from '@/components/layout/NotFound';
import { useMe } from '@/features/auth/AuthContext';
import { actionPermission, currentStep, isApprover } from '@/features/auth/permissions';
import { useHotkeys, useIsDesktop, useNow } from '@/hooks';
import { useShortcuts } from '@/components/layout/Shortcuts';
import { tierLabel } from '@/utils/cities';
import { CATEGORY_LABEL } from '@/utils/labels';
import { cn } from '@/utils/misc';
import { formatIST, formatISTDate, itemAge, secondsSince } from '@/utils/time';
import { ApprovalChain, ClaimTrail, Comments } from './ClaimPanels';
import { copyClaimToDraft } from './copyClaim';
import { DuplicateCompare } from './DuplicateCompare';
import { OutcomeSymbol, PolicyReasons } from './LinePolicyView';
import { claimFlags, isEditable, linePolicies, lineReceiptId } from './policy';
import { ReceiptViewer } from './ReceiptViewer';

type Dialog = 'reject' | 'send-back' | 'more' | null;
type Tab = 'steps' | 'comments' | 'trail';

export default function ClaimDetailPage() {
  const { id: idParam } = useParams();
  const id = Number(idParam);
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
  return <Detail key={q.data.id} claim={q.data} onRefresh={() => void q.refetch()} />;
}

function Detail({ claim, onRefresh }: { claim: ClaimDetail; onRefresh: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const desktop = useIsDesktop();
  const now = useNow();
  const shortcuts = useShortcuts();
  const backTo = (location.state as { from?: string } | null)?.from ?? (claim.employeeId === me.id ? '/claims' : '/inbox');

  const [lineIdx, setLineIdx] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [tab, setTab] = useState<Tab>('steps');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [dup, setDup] = useState<PolicyResult | null>(null);

  const perm = actionPermission(me, claim);
  const policies = useMemo(() => linePolicies(claim), [claim]);
  const flags = claimFlags(claim);
  const step = currentStep(claim);
  const age = step ? (secondsSince(step.activatedAt, now) ?? null) : null;
  const approver = isApprover(me);

  const inbox = useQuery({ queryKey: qk.inbox, queryFn: approvalsApi.inbox, enabled: approver, staleTime: 10_000 });

  const receipts = claim.lines.map((l, i) => ({
    lineId: l.id,
    receiptId: lineReceiptId(l),
    label: `Line ${i + 1} · ${CATEGORY_LABEL[l.category]} · ${l.vendor}`,
  }));

  // Prefer opening on the first line that has a receipt ("receipt first" for the stopwatch flow).
  useEffect(() => {
    const first = claim.lines.findIndex((l) => lineReceiptId(l));
    if (first > 0) setLineIdx(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim.id]);

  async function goNext(afterAction: string | null) {
    let list = inbox.data ?? [];
    if (afterAction) {
      try {
        list = await qc.fetchQuery({ queryKey: qk.inbox, queryFn: approvalsApi.inbox, staleTime: 0 });
      } catch {
        list = [];
      }
    }
    const next = [...list]
      .filter((i) => i.claimId !== claim.id)
      .sort((a, b) => (itemAge(b) ?? 0) - (itemAge(a) ?? 0))[0];
    if (next) {
      if (afterAction) toast.success(`${afterAction} · opening next`);
      navigate(`/claims/${next.claimId}`, { state: { from: backTo } });
    } else {
      if (afterAction) toast.success(`${afterAction} · inbox zero 🎉`);
      navigate(backTo);
    }
  }

  const onActionError = (e: unknown) => {
    if (e instanceof ApiError && e.isConflict) {
      setConflict(true);
      setDialog(null);
      return;
    }
    if (e instanceof ApiError && (e.isForbidden || e.isNotFound)) {
      toast.error('You are not the current approver for this claim.');
      setDialog(null);
      onRefresh();
      return;
    }
    if (e instanceof ApiError && e.isValidation) {
      setReasonError(e.fieldErrors.reason ?? e.fieldErrors.comment ?? errorMessage(e));
      return;
    }
    toast.error(errorMessage(e));
  };

  const afterSuccess = async (label: string) => {
    setDialog(null);
    setNote('');
    setReason('');
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.claims }),
      qc.invalidateQueries({ queryKey: qk.auditorQueue }),
    ]);
    await goNext(label);
  };

  const approve = useMutation({
    mutationFn: () => claimsApi.approve(claim.id, claim.version, note.trim() || undefined),
    onSuccess: () => afterSuccess('Approved'),
    onError: onActionError,
  });
  const reject = useMutation({
    mutationFn: (r: string) => claimsApi.reject(claim.id, claim.version, r),
    onSuccess: () => afterSuccess('Rejected'),
    onError: onActionError,
  });
  const sendBack = useMutation({
    mutationFn: (c: string) => claimsApi.sendBack(claim.id, claim.version, c),
    onSuccess: () => afterSuccess('Sent back'),
    onError: onActionError,
  });
  const copy = useMutation({
    mutationFn: () => copyClaimToDraft(claim),
    onSuccess: (draft) => {
      void qc.invalidateQueries({ queryKey: qk.claims });
      toast.success('Copied to a new draft. Attach the receipts again.');
      navigate(`/claims/${draft.id}/edit`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const busy = approve.isPending || reject.isPending || sendBack.isPending;

  function openReason(kind: 'reject' | 'send-back') {
    setReason('');
    setReasonError(null);
    setDialog(kind);
  }

  function confirmReason() {
    if (!reason.trim()) {
      setReasonError(dialog === 'reject' ? 'A reason is required to reject.' : 'A comment is required to send back.');
      return;
    }
    if (dialog === 'reject') reject.mutate(reason.trim());
    else sendBack.mutate(reason.trim());
  }

  useHotkeys({
    j: () => setLineIdx((i) => Math.min(i + 1, claim.lines.length - 1)),
    k: () => setLineIdx((i) => Math.max(i - 1, 0)),
    a: () => perm.canAct && !busy && approve.mutate(),
    s: () => perm.canAct && openReason('send-back'),
    r: () => perm.canAct && openReason('reject'),
    n: () => approver && void goNext(null),
  });

  const selected = claim.lines[lineIdx];

  // ---------------- pieces ----------------
  const header = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-bold text-slate-900 sm:text-xl" data-testid="claim-no">
          {claim.claimNo}
        </h1>
        <span className="text-slate-600">·</span>
        <span className="font-medium text-slate-800" data-testid="claim-employee">
          {claim.employeeName ?? `Employee #${claim.employeeId}`}
        </span>
        <StatusChip status={claim.status} />
      </div>
      <p className="text-sm text-slate-700">{claim.title}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700">
        {claim.department && <span>{claim.department}</span>}
        <Money value={claim.totalAmount} strong className="text-base text-slate-900" />
        {age !== null && (
          <span className="inline-flex items-center gap-1">
            age <AgeBadge seconds={age} />
          </span>
        )}
        {claim.submittedAt && <span className="text-xs text-slate-600">Submitted {formatIST(claim.submittedAt)}</span>}
      </div>
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1" data-testid="claim-flags">
          {flags.map((f) => (
            <FlagChip key={f} flag={f} />
          ))}
        </div>
      )}
    </div>
  );

  const banners = (
    <div className="space-y-2">
      {conflict && (
        <ConflictBanner
          onRefresh={() => {
            setConflict(false);
            onRefresh();
          }}
        />
      )}
      {perm.canAct && perm.onBehalfOf && (
        <Banner tone="info" testId="on-behalf-banner">
          You are acting on behalf of <strong>{perm.onBehalfOf}</strong> (delegation). The audit trail will record this.
        </Banner>
      )}
      {!perm.canAct && perm.reason && (perm.isOwner ? claim.status.startsWith('PENDING_') : approver) && (
        <Banner tone={perm.isOwner ? 'warning' : 'info'} title="Read-only" testId="readonly-banner">
          {perm.reason}
        </Banner>
      )}
      {claim.status === 'POLICY_REJECTED' && (
        <Banner
          tone="error"
          title="Rejected by policy"
          testId="policy-rejected-banner"
          action={
            perm.isOwner && (
              <Button size="sm" icon={<Copy className="h-4 w-4" aria-hidden />} loading={copy.isPending} onClick={() => copy.mutate()} testId="copy-to-draft">
                Copy to new draft
              </Button>
            )
          }
        >
          At least one line broke a rejecting rule. The reasons are listed on each line.
        </Banner>
      )}
      {perm.isOwner && isEditable(claim) && (
        <Banner
          tone={claim.status === 'SENT_BACK' ? 'orange' : 'info'}
          title={claim.status === 'SENT_BACK' ? 'Sent back to you' : 'Draft'}
          action={
            <Link
              to={`/claims/${claim.id}/edit`}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-800"
              data-testid="edit-claim"
            >
              <Pencil className="h-4 w-4" aria-hidden /> Edit
            </Link>
          }
        >
          {claim.status === 'SENT_BACK' ? 'Make the requested changes and resubmit.' : 'This claim has not been submitted yet.'}
        </Banner>
      )}
    </div>
  );

  const lines = (
    <section aria-labelledby="detail-lines" className="rounded-xl border border-slate-200/80 bg-white shadow-xs">
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
        <h2 id="detail-lines" className="text-sm font-semibold text-slate-900">
          Lines ({claim.lines.length})
        </h2>
        <span className="hidden text-xs text-slate-500 sm:inline">J / K to move</span>
      </header>
      <ul className="divide-y divide-slate-100" role="listbox" aria-label="Claim lines" aria-activedescendant={selected ? `dl-${selected.id}` : undefined}>
        {claim.lines.map((l, i) => {
          const p = policies.get(l.id);
          const active = i === lineIdx;
          return (
            <li
              key={l.id}
              id={`dl-${l.id}`}
              role="option"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setLineIdx(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setLineIdx(i);
                }
              }}
              className={cn('cursor-pointer px-4 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600', active ? 'bg-indigo-50' : 'hover:bg-slate-50')}
              data-testid={`detail-line-${i}`}
            >
              <div className="flex items-center gap-2">
                <span className="w-4 text-xs font-semibold text-slate-500">{i + 1}</span>
                <OutcomeSymbol policy={p} testId={`detail-line-outcome-${i}`} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                  {CATEGORY_LABEL[l.category]} · {l.vendor}
                </span>
                <Money value={l.amount} strong />
              </div>
              <p className="ml-6 mt-0.5 text-xs text-slate-600">
                {formatISTDate(l.expenseDate)}
                {l.city && ` · ${l.city} (${tierLabel(l.cityTier)})`}
                {l.category === 'HOTEL' && ` · ${l.nights} night${(l.nights ?? 0) > 1 ? 's' : ''}`}
                {lineReceiptId(l) ? ' · receipt ✓' : ' · no receipt'}
              </p>
              {l.description && <p className="ml-6 mt-0.5 text-xs italic text-slate-700">“{l.description}”</p>}
              <div className="ml-6 mt-1">
                <PolicyReasons results={p?.results ?? []} onDuplicate={setDup} compact />
              </div>
            </li>
          );
        })}
      </ul>
      {claim.policyOutcome && (
        <div className="flex items-center gap-2 border-t border-slate-200 px-4 py-2 text-xs text-slate-700">
          Claim outcome: <OutcomeBadge outcome={claim.policyOutcome} />
        </div>
      )}
    </section>
  );

  const tabs = (
    <section className="rounded-xl border border-slate-200/80 bg-white shadow-xs">
      <div role="tablist" aria-label="Claim details" className="flex border-b border-slate-200">
        {(
          [
            ['steps', 'Steps'],
            ['comments', `Comments (${claim.comments.length})`],
            ['trail', 'Trail'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            aria-controls={`tab-${k}`}
            onClick={() => setTab(k)}
            data-testid={`detail-tab-${k}`}
            className={cn(
              '-mb-px flex-1 border-b-2 px-3 py-2.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600',
              tab === k ? 'border-indigo-700 text-indigo-800' : 'border-transparent text-slate-600 hover:text-slate-900',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div id={`tab-${tab}`} role="tabpanel" className="p-4">
        {tab === 'steps' && <ApprovalChain claim={claim} />}
        {tab === 'comments' && (
          <Comments claim={claim} canComment={claim.status.startsWith('PENDING_') || claim.status === 'SENT_BACK'} />
        )}
        {tab === 'trail' && <ClaimTrail claimId={claim.id} />}
      </div>
    </section>
  );

  const actionBar = perm.canAct && (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="Approval actions" data-testid="action-bar">
      <Field label="Note (optional, saved with your approval)" testId="approve-note">
        {(p) => <Textarea {...p} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} data-testid="approve-note" />}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="success"
          size="lg"
          className="flex-1 sm:flex-none"
          icon={<Check className="h-5 w-5" aria-hidden />}
          loading={approve.isPending}
          disabled={busy}
          onClick={() => approve.mutate()}
          testId="approve-btn"
        >
          Approve <kbd className="ml-1 hidden rounded bg-white/20 px-1 text-xs sm:inline">A</kbd>
        </Button>
        <Button
          size="lg"
          icon={<RotateCcw className="h-4 w-4" aria-hidden />}
          disabled={busy}
          onClick={() => openReason('send-back')}
          testId="send-back-btn"
        >
          Send back
        </Button>
        <Button variant="danger" size="lg" icon={<X className="h-4 w-4" aria-hidden />} disabled={busy} onClick={() => openReason('reject')} testId="reject-btn">
          Reject
        </Button>
      </div>
    </section>
  );

  const topNav = (
    <div className="mb-3 flex items-center justify-between gap-2">
      <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-slate-700 hover:text-slate-900" data-testid="detail-back">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Back
      </Link>
      <div className="flex items-center gap-1">
        {approver && (
          <Button size="sm" variant="ghost" icon={<SkipForward className="h-4 w-4" aria-hidden />} onClick={() => void goNext(null)} testId="next-claim">
            Next <kbd className="ml-1 hidden rounded bg-slate-100 px-1 text-xs sm:inline">N</kbd>
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<Keyboard className="h-4 w-4" aria-hidden />} onClick={shortcuts.open} testId="shortcuts" className="hidden sm:inline-flex">
          Shortcuts
        </Button>
      </div>
    </div>
  );

  return (
    <div className={cn(!desktop && perm.canAct && 'pb-20')}>
      {topNav}
      {desktop ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5">
          <div className="sticky top-0 self-start">
            <ReceiptViewer receipts={receipts} index={lineIdx} onIndexChange={setLineIdx} heightClass="h-[calc(100dvh-10.5rem)]" />
          </div>
          <div className="min-w-0 space-y-4">
            {header}
            {banners}
            {actionBar}
            {lines}
            {tabs}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <ReceiptViewer receipts={receipts} index={lineIdx} onIndexChange={setLineIdx} heightClass="h-64" />
          {header}
          {banners}
          {lines}
          {tabs}
        </div>
      )}

      {/* mobile sticky action bar */}
      {!desktop && perm.canAct && (
        <div className="fixed inset-x-0 bottom-14 z-20 flex gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] backdrop-blur md:bottom-0 md:left-[var(--sidebar-w)]">
          <Button
            variant="success"
            size="lg"
            className="flex-1"
            icon={<Check className="h-5 w-5" aria-hidden />}
            loading={approve.isPending}
            disabled={busy}
            onClick={() => approve.mutate()}
            testId="m-approve-btn"
          >
            Approve
          </Button>
          <Button size="lg" aria-label="More actions" onClick={() => setDialog('more')} testId="m-more-actions">
            <MoreHorizontal className="h-5 w-5" aria-hidden />
          </Button>
        </div>
      )}

      <Modal open={dialog === 'more'} onClose={() => setDialog(null)} title="Actions" variant="sheet" size="sm" testId="more-actions">
        <div className="grid gap-2">
          <Button size="lg" icon={<RotateCcw className="h-4 w-4" aria-hidden />} onClick={() => openReason('send-back')} testId="m-send-back-btn">
            Send back
          </Button>
          <Button size="lg" variant="danger" icon={<X className="h-4 w-4" aria-hidden />} onClick={() => openReason('reject')} testId="m-reject-btn">
            Reject
          </Button>
          <Button
            size="lg"
            variant="ghost"
            onClick={() => {
              setDialog(null);
              setTab('comments');
            }}
            testId="m-comment-btn"
          >
            Comment
          </Button>
        </div>
      </Modal>

      <Modal
        open={dialog === 'reject' || dialog === 'send-back'}
        onClose={() => setDialog(null)}
        title={dialog === 'reject' ? `Reject ${claim.claimNo}` : `Send ${claim.claimNo} back`}
        size="md"
        testId={dialog === 'reject' ? 'reject-dialog' : 'send-back-dialog'}
        footer={
          <>
            <Button onClick={() => setDialog(null)} testId="reason-cancel">
              Cancel
            </Button>
            <Button
              variant={dialog === 'reject' ? 'danger' : 'primary'}
              loading={reject.isPending || sendBack.isPending}
              onClick={confirmReason}
              testId="reason-confirm"
            >
              {dialog === 'reject' ? 'Reject claim' : 'Send back'}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <p className="text-sm text-slate-700">
            {dialog === 'reject'
              ? 'Rejecting ends this claim. The employee will see your reason.'
              : 'The employee can edit the claim and resubmit. Approvals restart from the manager.'}
          </p>
          <Field label={dialog === 'reject' ? 'Reason' : 'Comment for the employee'} required error={reasonError} testId="reason-input">
            {(p) => (
              <Textarea
                {...p}
                autoFocus
                rows={3}
                maxLength={1000}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setReasonError(null);
                }}
                data-testid="reason-input"
              />
            )}
          </Field>
        </div>
      </Modal>


      <DuplicateCompare claim={claim} result={dup} onClose={() => setDup(null)} />
    </div>
  );
}
