import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, CircleDot, MinusCircle, RotateCcw, XCircle } from 'lucide-react';
import { auditApi } from '@/api/audit';
import { claimsApi } from '@/api/claims';
import { errorMessage } from '@/api/client';
import { qk } from '@/api/keys';
import type { ApprovalStep, ClaimDetail, StepStatus } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { ErrorBanner, SkeletonRows } from '@/components/ui/Display';
import { Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { LEVEL_LABEL } from '@/utils/labels';
import { cn } from '@/utils/misc';
import { formatIST } from '@/utils/time';

const STEP_ICON: Record<StepStatus, { Icon: typeof Circle; cls: string; label: string }> = {
  WAITING: { Icon: Circle, cls: 'text-slate-400', label: 'Waiting' },
  PENDING: { Icon: CircleDot, cls: 'text-amber-600', label: 'Pending' },
  APPROVED: { Icon: CheckCircle2, cls: 'text-green-700', label: 'Approved' },
  REJECTED: { Icon: XCircle, cls: 'text-red-700', label: 'Rejected' },
  SENT_BACK: { Icon: RotateCcw, cls: 'text-orange-700', label: 'Sent back' },
  CANCELLED: { Icon: MinusCircle, cls: 'text-slate-400', label: 'Cancelled' },
};

function StepRow({ s }: { s: ApprovalStep }) {
  const cfg = STEP_ICON[s.status] ?? STEP_ICON.WAITING;
  const actor = s.actedByName ?? (s.actedById ? `#${s.actedById}` : null);
  return (
    <li className="flex gap-3" data-testid={`step-${s.level}`} data-status={s.status}>
      <cfg.Icon className={cn('mt-0.5 h-5 w-5 shrink-0', cfg.cls)} aria-hidden />
      <div className="min-w-0 text-sm">
        <p className="font-medium text-slate-900">
          {LEVEL_LABEL[s.level]} <span className="font-normal text-slate-600">· {cfg.label}</span>
        </p>
        <p className="text-xs text-slate-600">
          Assigned to {s.assigneeName ?? (s.assigneeId ? `#${s.assigneeId}` : `${LEVEL_LABEL[s.level]} pool`)}
        </p>
        {actor && (
          <p className="text-xs text-slate-700" data-testid={`step-${s.level}-actor`}>
            {cfg.label} by <strong>{actor}</strong>
            {s.onBehalfOfName || s.onBehalfOfId ? (
              <>
                {' '}
                on behalf of <strong>{s.onBehalfOfName ?? `#${s.onBehalfOfId}`}</strong>
              </>
            ) : null}
            {s.actedAt ? ` · ${formatIST(s.actedAt)}` : ''}
          </p>
        )}
        {s.note && <p className="mt-0.5 rounded bg-slate-50 px-2 py-1 text-xs text-slate-800">“{s.note}”</p>}
      </div>
    </li>
  );
}

export function ApprovalChain({ claim }: { claim: ClaimDetail }) {
  const steps = claim.approvalSteps;
  if (steps.length === 0) {
    const msg =
      claim.status === 'APPROVED' || claim.status === 'IN_PAYOUT' || claim.status === 'PAID'
        ? 'Auto-approved by policy. No approval chain was needed.'
        : claim.status === 'POLICY_REJECTED'
          ? 'Rejected by policy at submission.'
          : 'No approval chain yet. It is created when the claim is submitted.';
    return <p className="text-sm text-slate-600">{msg}</p>;
  }
  const maxCycle = steps.reduce((m, s) => Math.max(m, s.cycleNo ?? 1), 1);
  const current = steps.filter((s) => (s.cycleNo ?? 1) === maxCycle).sort((a, b) => a.seq - b.seq);
  const older = steps.filter((s) => (s.cycleNo ?? 1) !== maxCycle).sort((a, b) => (a.cycleNo ?? 1) - (b.cycleNo ?? 1) || a.seq - b.seq);
  return (
    <div className="space-y-3" data-testid="approval-chain">
      {maxCycle > 1 && <p className="text-xs text-slate-600">Cycle {maxCycle} (restarted after send-back)</p>}
      <ol className="space-y-3">
        {current.map((s) => (
          <StepRow key={s.id} s={s} />
        ))}
      </ol>
      {older.length > 0 && (
        <details className="rounded-lg border border-slate-200 p-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-700">Earlier cycles ({older.length} steps)</summary>
          <ol className="mt-2 space-y-3">
            {older.map((s) => (
              <StepRow key={s.id} s={s} />
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

export function Comments({ claim, canComment }: { claim: ClaimDetail; canComment: boolean }) {
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const add = useMutation({
    mutationFn: (text: string) => claimsApi.comment(claim.id, text),
    onSuccess: async () => {
      setBody('');
      toast.success('Comment added');
      await qc.invalidateQueries({ queryKey: qk.claim(claim.id) });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) {
      setError('Write a comment first.');
      return;
    }
    setError(null);
    add.mutate(body.trim());
  }

  const sorted = [...claim.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (
    <div className="space-y-3" data-testid="comments">
      {sorted.length === 0 ? (
        <p className="text-sm text-slate-600">No comments yet.</p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((c) => (
            <li key={c.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm" data-testid={`comment-${c.id}`}>
              <p className="text-xs text-slate-600">
                <strong className="text-slate-800">{c.authorName ?? `#${c.authorId}`}</strong>
                {c.authorId === claim.employeeId && ' (owner)'} · {formatIST(c.createdAt)}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-slate-900">{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canComment && (
        <form onSubmit={submit} className="space-y-2" noValidate>
          <label htmlFor="comment-body" className="text-sm font-medium text-slate-800">
            Add a comment
          </label>
          <Textarea
            id="comment-body"
            rows={2}
            maxLength={1000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'comment-error' : undefined}
            data-testid="comment-input"
          />
          {error && (
            <p id="comment-error" role="alert" className="text-xs text-red-700">
              {error}
            </p>
          )}
          <Button type="submit" size="sm" loading={add.isPending} testId="comment-submit">
            Post comment
          </Button>
        </form>
      )}
    </div>
  );
}

export function ClaimTrail({ claimId }: { claimId: number }) {
  const q = useQuery({
    queryKey: [...qk.audit, 'claim', claimId],
    queryFn: () => auditApi.list({ claimId: String(claimId) }),
  });
  if (q.isPending) return <SkeletonRows rows={3} />;
  if (q.isError) return <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />;
  const events = [...q.data.content].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (events.length === 0) return <p className="text-sm text-slate-600">No audit events.</p>;
  return (
    <ol className="space-y-2 border-l-2 border-slate-200 pl-4" data-testid="claim-trail">
      {events.map((e) => (
        <li key={e.id} className="text-sm">
          <p className="font-medium text-slate-900">{e.action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</p>
          <p className="text-xs text-slate-600">
            {formatIST(e.createdAt)} · by {e.actorName ?? (e.actorId ? `#${e.actorId}` : 'System')}
            {(e.onBehalfOfName || e.onBehalfOfId) && (
              <>
                {' '}
                on behalf of <strong>{e.onBehalfOfName ?? `#${e.onBehalfOfId}`}</strong>
              </>
            )}
          </p>
        </li>
      ))}
    </ol>
  );
}
