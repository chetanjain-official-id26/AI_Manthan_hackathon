import { CheckCircle2, Flag as FlagIcon, XCircle } from 'lucide-react';
import type { PolicyResult } from '@/api/types';
import { FlagChip } from '@/components/ui/Chips';
import { explainResult } from '@/utils/labels';
import { cn } from '@/utils/misc';
import type { LinePolicy } from './policy';

/** ✓ / ⚑ / ✕ symbol with an accessible label. */
export function OutcomeSymbol({ policy, testId }: { policy: LinePolicy | undefined; testId?: string }) {
  const o = policy?.outcome;
  if (!o) {
    return (
      <span className="text-xs text-slate-500" data-testid={testId}>
        —<span className="sr-only">Not checked yet</span>
      </span>
    );
  }
  const cfg = {
    AUTO_APPROVE: { Icon: CheckCircle2, cls: 'text-green-700', label: 'Passes policy' },
    ROUTE: { Icon: FlagIcon, cls: 'text-amber-700', label: 'Needs approval' },
    AUTO_REJECT: { Icon: XCircle, cls: 'text-red-700', label: 'Will be rejected' },
  }[o];
  return (
    <span className={cn('inline-flex items-center', cfg.cls)} title={cfg.label} data-testid={testId} data-outcome={o}>
      <cfg.Icon className="h-5 w-5" aria-hidden />
      <span className="sr-only">{cfg.label}</span>
    </span>
  );
}

/** List of policy reasons for one line: flag chip + "rule, limit, actual" text. */
export function PolicyReasons({
  results,
  onDuplicate,
  compact = false,
}: {
  results: PolicyResult[];
  onDuplicate?: (r: PolicyResult) => void;
  compact?: boolean;
}) {
  const shown = results.filter((r) => r.outcome !== 'AUTO_APPROVE' || r.flag);
  if (shown.length === 0) {
    return compact ? null : <p className="text-xs text-green-800">✓ Within policy</p>;
  }
  return (
    <ul className="space-y-1" data-testid="policy-reasons">
      {shown.map((r, i) => (
        <li
          key={`${r.ruleCode}-${i}`}
          className={cn(
            'flex flex-wrap items-center gap-1.5 text-xs',
            r.outcome === 'AUTO_REJECT' ? 'text-red-800' : 'text-slate-800',
          )}
          data-testid={`policy-reason-${r.ruleCode}`}
        >
          {r.outcome === 'AUTO_REJECT' ? (
            <span className="font-semibold">✕</span>
          ) : r.flag ? (
            <FlagChip flag={r.flag} detail={explainResult(r)} />
          ) : (
            <span className="font-semibold">⚑</span>
          )}
          <span>{explainResult(r)}</span>
          {r.flag === 'DUPLICATE' && onDuplicate && (r.matchClaimId || r.matchClaimNo) && (
            <button
              type="button"
              onClick={() => onDuplicate(r)}
              className="font-medium text-indigo-700 underline hover:text-indigo-900"
              data-testid={`duplicate-compare-${r.claimLineId}`}
            >
              Matches {r.matchClaimNo ?? `claim #${r.matchClaimId}`}
              {r.matchLineId ? ' · compare' : ''}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
