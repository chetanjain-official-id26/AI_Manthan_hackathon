import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { claimsApi } from '@/api/claims';
import { ApiError } from '@/api/client';
import { qk } from '@/api/keys';
import type { ClaimDetail, ClaimLine, PolicyResult } from '@/api/types';
import { Banner, Money, SkeletonRows } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Modal';
import { tierLabel } from '@/utils/cities';
import { CATEGORY_LABEL } from '@/utils/labels';
import { formatISTDate } from '@/utils/time';
import { lineReceiptId } from './policy';
import { ReceiptViewer } from './ReceiptViewer';

interface Props {
  claim: ClaimDetail;
  result: PolicyResult | null;
  onClose: () => void;
}

/** Side-by-side comparison of a DUPLICATE-flagged line and the line it matches. */
export function DuplicateCompare({ claim, result, onClose }: Props) {
  const matchId = result?.matchClaimId ?? null;
  const q = useQuery({
    queryKey: qk.claim(matchId ?? 0),
    queryFn: () => claimsApi.get(matchId as number),
    enabled: !!matchId,
  });
  const line = result ? claim.lines.find((l) => l.id === result.claimLineId) : undefined;
  const matchLine = q.data && result?.matchLineId ? q.data.lines.find((l) => l.id === result.matchLineId) : q.data?.lines[0];

  return (
    <Modal open={!!result} onClose={onClose} title="Possible duplicate" size="xl" testId="duplicate-compare">
      <div className="grid gap-4 md:grid-cols-2">
        <Side title={`This claim · ${claim.claimNo}`} owner={claim.employeeName} line={line} />
        {q.isPending ? (
          <SkeletonRows rows={4} />
        ) : q.isError ? (
          <Banner tone="warning" title={`Matches ${result?.matchClaimNo ?? 'another claim'}`}>
            {q.error instanceof ApiError && q.error.isNotFound
              ? 'You do not have access to the matching claim. The receipt hash or vendor/amount/date match was confirmed by the server.'
              : 'The matching claim could not be loaded.'}
          </Banner>
        ) : (
          <div>
            <Side title={`Matching · ${q.data.claimNo}`} owner={q.data.employeeName} line={matchLine} />
            <Link
              to={`/claims/${q.data.id}`}
              onClick={onClose}
              className="mt-2 inline-block text-sm font-medium text-indigo-700 underline"
              data-testid="duplicate-open-match"
            >
              Open {q.data.claimNo}
            </Link>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Side({ title, owner, line }: { title: string; owner?: string; line?: ClaimLine }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {owner && <p className="text-xs text-slate-600">Employee: {owner}</p>}
      {line ? (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-3 text-sm">
            <dt className="text-slate-600">Category</dt>
            <dd>{CATEGORY_LABEL[line.category]}</dd>
            <dt className="text-slate-600">Vendor</dt>
            <dd className="truncate">{line.vendor}</dd>
            <dt className="text-slate-600">Date</dt>
            <dd>{formatISTDate(line.expenseDate)}</dd>
            <dt className="text-slate-600">Amount</dt>
            <dd>
              <Money value={line.amount} strong />
            </dd>
            <dt className="text-slate-600">City</dt>
            <dd>
              {line.city ?? '—'} ({tierLabel(line.cityTier)})
            </dd>
            {line.receipt?.sha256 && (
              <>
                <dt className="text-slate-600">SHA-256</dt>
                <dd className="truncate font-mono text-xs" title={line.receipt.sha256}>
                  {line.receipt.sha256.slice(0, 16)}…
                </dd>
              </>
            )}
          </dl>
          <ReceiptViewer
            receipts={[{ lineId: line.id, receiptId: lineReceiptId(line), label: `${CATEGORY_LABEL[line.category]} · ${line.vendor}` }]}
            index={0}
            heightClass="h-64"
            testId={`dup-receipt-${line.id}`}
          />
        </>
      ) : (
        <p className="text-sm text-slate-600">Line details unavailable.</p>
      )}
    </div>
  );
}
