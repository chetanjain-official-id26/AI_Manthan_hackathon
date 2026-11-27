import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronRight, Plus } from 'lucide-react';
import { claimsApi } from '@/api/claims';
import { qk } from '@/api/keys';
import type { ClaimStatus, ClaimSummary } from '@/api/types';
import { StatusChip } from '@/components/ui/Chips';
import { EmptyState, ErrorBanner, Money, PageHeader, Pagination, SkeletonRows } from '@/components/ui/Display';
import { useIsTabletUp } from '@/hooks';
import { CLAIM_STATUSES } from '@/api/types';
import { useMe } from '@/features/auth/AuthContext';
import { hasRole } from '@/features/auth/permissions';
import { STATUS_LABEL } from '@/utils/labels';
import { cn } from '@/utils/misc';
import { formatIST, formatISTDate } from '@/utils/time';
import { claimHref } from './policy';

const FILTERS: (ClaimStatus | '')[] = [
  '',
  'DRAFT',
  'SENT_BACK',
  'PENDING_MANAGER',
  'PENDING_AUDITOR',
  'PENDING_FINANCE_HEAD',
  'APPROVED',
  'IN_PAYOUT',
  'PAID',
  'POLICY_REJECTED',
  'REJECTED',
];

function sortKey(c: ClaimSummary): number {
  const t = c.updatedAt ?? c.submittedAt ?? c.createdAt;
  return t ? new Date(t).getTime() : 0;
}

type Scope = 'mine' | 'others';

export default function MyClaimsPage() {
  const me = useMe();
  const [sp, setSp] = useSearchParams();
  const rawStatus = sp.get('status');
  const status: ClaimStatus | '' = rawStatus && (CLAIM_STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as ClaimStatus) : '';
  const page = Number(sp.get('page') ?? '0') || 0;
  // Managers can also list their reportees' claims; auditors and the finance head can list all (BR-26).
  const othersLabel = hasRole(me, 'AUDITOR', 'FINANCE_HEAD') ? 'All claims' : hasRole(me, 'MANAGER') ? 'My team' : null;
  const scope: Scope = othersLabel && sp.get('scope') === 'others' ? 'others' : 'mine';
  const navigate = useNavigate();
  const tabletUp = useIsTabletUp();

  const setParams = (patch: { status?: ClaimStatus | ''; page?: number; scope?: Scope }) => {
    const n = new URLSearchParams(sp);
    const apply = (k: string, v: string | number | undefined) => {
      if (v === undefined) return;
      if (v === '' || v === 0 || v === 'mine') n.delete(k);
      else n.set(k, String(v));
    };
    apply('status', patch.status);
    apply('scope', patch.scope);
    if (patch.page !== undefined) apply('page', patch.page);
    else n.delete('page');
    setSp(n, { replace: true });
  };
  const setStatus = (s: ClaimStatus | '') => setParams({ status: s });
  const setPage = (p: number) => setParams({ page: p });

  const q = useQuery({
    queryKey: qk.claimList(scope, status, page),
    queryFn: () => claimsApi.list({ mine: scope === 'mine', status, page }),
    placeholderData: keepPreviousData,
  });

  const href = (c: ClaimSummary) => (scope === 'mine' ? claimHref(c) : `/claims/${c.id}`);
  const rows = useMemo(() => [...(q.data?.content ?? [])].sort((a, b) => sortKey(b) - sortKey(a)), [q.data]);

  const newButton = (
    <Link
      to="/claims/new"
      data-testid="new-claim"
      className="hidden items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 md:inline-flex"
    >
      <Plus className="h-4 w-4" aria-hidden /> New claim
    </Link>
  );

  return (
    <div>
      <PageHeader
        title={scope === 'mine' ? 'My claims' : othersLabel ?? 'Claims'}
        subtitle={scope === 'mine' ? 'Drafts, submitted claims and their status' : 'Claims you are allowed to see, read-only'}
        actions={newButton}
      />

      {othersLabel && (
        <div className="mb-3 inline-flex rounded-lg bg-slate-100 p-1" role="group" aria-label="Whose claims">
          {(
            [
              ['mine', 'Mine'],
              ['others', othersLabel],
            ] as [Scope, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={scope === k}
              onClick={() => setParams({ scope: k })}
              data-testid={`claims-scope-${k}`}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600',
                scope === k ? 'bg-white text-indigo-800 shadow-sm' : 'text-slate-700 hover:text-slate-900',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="-mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label="Filter by status">
        <div className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
          {FILTERS.map((s) => (
            <button
              key={s || 'ALL'}
              type="button"
              aria-pressed={status === s}
              onClick={() => setStatus(s)}
              data-testid={`status-filter-${s || 'ALL'}`}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600',
                status === s ? 'border-indigo-700 bg-indigo-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
              )}
            >
              {s ? STATUS_LABEL[s] : 'All'}
            </button>
          ))}
        </div>
      </div>

      {q.isPending ? (
        <SkeletonRows />
      ) : q.isError ? (
        <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={status ? `No ${STATUS_LABEL[status].toLowerCase()} claims` : scope === 'others' ? 'No claims to show' : 'No claims yet'}
          description={status ? 'Try another status filter.' : 'Create your first claim to get reimbursed.'}
          action={
            !status && scope === 'mine' && (
              <Link
                to="/claims/new"
                className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800"
                data-testid="empty-new-claim"
              >
                Create your first claim
              </Link>
            )
          }
          testId="claims-empty"
        />
      ) : tabletUp ? (
        <div className="ef-table-wrap ef-scroll">
          <table className="w-full text-sm" data-testid="claims-table">
            <thead className="ef-thead text-left font-semibold uppercase">
              <tr>
                <th scope="col" className="px-4 py-3">Claim no</th>
                {scope === 'others' && <th scope="col" className="px-4 py-3">Employee</th>}
                <th scope="col" className="px-4 py-3">Title</th>
                <th scope="col" className="px-4 py-3">Submitted</th>
                <th scope="col" className="px-4 py-3 text-right">Lines</th>
                <th scope="col" className="px-4 py-3 text-right">Total</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="hidden px-4 py-3 xl:table-cell">Last action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 [&>tr:hover]:bg-slate-50/80">
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => navigate(href(c))}
                  data-testid={`claim-row-${c.id}`}
                >
                  <td className="px-4 py-3 font-medium">
                    <Link to={href(c)} className="whitespace-nowrap text-indigo-700 hover:underline" onClick={(e) => e.stopPropagation()} data-testid={`claim-link-${c.id}`}>
                      {c.claimNo}
                    </Link>
                  </td>
                  {scope === 'others' && <td className="px-4 py-3 text-slate-800">{c.employeeName ?? '—'}</td>}
                  <td className="max-w-[16rem] truncate px-4 py-3 text-slate-800">{c.title}</td>
                  <td className="px-4 py-3 text-slate-700">{formatISTDate(c.submittedAt)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.lineCount ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <Money value={c.totalAmount} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={c.status} />
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-slate-600 xl:table-cell">
                    {c.lastAction ?? formatIST(c.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="claims-cards">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                to={href(c)}
                data-testid={`claim-card-${c.id}`}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-slate-900">
                      {scope === 'others' && c.employeeName ? `${c.employeeName} · ` : ''}
                      {c.title}
                    </span>
                    <Money value={c.totalAmount} strong />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-600">
                      {c.claimNo} · {formatISTDate(c.submittedAt ?? c.createdAt)}
                    </span>
                    <StatusChip status={c.status} />
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {q.data && (
        <Pagination page={q.data.page} totalPages={q.data.totalPages} totalElements={q.data.totalElements} onPage={setPage} />
      )}

      {/* Mobile floating action button */}
      <Link
        to="/claims/new"
        aria-label="New claim"
        data-testid="new-claim-fab"
        className="fixed bottom-20 right-4 z-20 flex items-center gap-2 rounded-full bg-indigo-700 px-5 py-3.5 text-sm font-semibold text-white shadow-lg hover:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 md:hidden"
      >
        <Plus className="h-5 w-5" aria-hidden /> New claim
      </Link>
    </div>
  );
}
