import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, PartyPopper, RefreshCw } from 'lucide-react';
import { approvalsApi } from '@/api/approvals';
import { qk } from '@/api/keys';
import type { InboxItem } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { FlagList } from '@/components/ui/Chips';
import { AgeBadge, EmptyState, ErrorBanner, Money, PageHeader, SkeletonRows } from '@/components/ui/Display';
import { useHotkeys, useIsTabletUp, useNow } from '@/hooks';
import { LEVEL_LABEL } from '@/utils/labels';
import { itemAge } from '@/utils/time';

export default function InboxPage() {
  const navigate = useNavigate();
  const tabletUp = useIsTabletUp();
  const now = useNow();

  const q = useQuery({ queryKey: qk.inbox, queryFn: approvalsApi.inbox, refetchInterval: 60_000 });

  const rows = useMemo(() => {
    const list = (q.data ?? []).map((i) => ({ item: i, age: itemAge(i) ?? 0 }));
    return list.sort((a, b) => b.age - a.age);
    // `now` keeps ages fresh between refetches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, now]);

  const open = (i: InboxItem) => navigate(`/claims/${i.claimId}`, { state: { from: '/inbox' } });

  useHotkeys({
    Enter: () => {
      const top = rows[0];
      if (top) open(top.item);
    },
  });

  return (
    <div>
      <PageHeader
        title="Approval inbox"
        subtitle={
          rows.length > 0 ? (
            <>
              {rows.length} waiting · oldest first · press <kbd className="rounded border border-slate-300 bg-white px-1 text-xs">Enter</kbd> to open
              the oldest
            </>
          ) : (
            'Claims waiting for your decision'
          )
        }
        actions={
          <Button size="sm" icon={<RefreshCw className="h-4 w-4" aria-hidden />} onClick={() => void q.refetch()} loading={q.isFetching && !q.isPending} testId="inbox-refresh">
            Refresh
          </Button>
        }
      />

      {q.isPending ? (
        <SkeletonRows />
      ) : q.isError ? (
        <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<PartyPopper className="h-10 w-10" aria-hidden />}
          title="Inbox zero 🎉"
          description="Nothing is waiting for you. New claims appear here oldest first."
          testId="inbox-empty"
        />
      ) : tabletUp ? (
        <div className="ef-table-wrap ef-scroll">
          <table className="w-full text-sm" data-testid="inbox-table">
            <thead className="ef-thead text-left font-semibold uppercase">
              <tr>
                <th scope="col" className="px-4 py-3">Age</th>
                <th scope="col" className="px-4 py-3">Claim no</th>
                <th scope="col" className="px-4 py-3">Employee</th>
                <th scope="col" className="hidden px-4 py-3 lg:table-cell">Dept</th>
                <th scope="col" className="px-4 py-3 text-right">Total</th>
                <th scope="col" className="px-4 py-3">Flags</th>
                <th scope="col" className="px-4 py-3">Step</th>
                <th scope="col" className="hidden px-4 py-3 xl:table-cell">On behalf of</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 [&>tr:hover]:bg-slate-50/80">
              {rows.map(({ item, age }, idx) => (
                <tr
                  key={`${item.claimId}-${item.level}`}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => open(item)}
                  data-testid={`inbox-row-${idx}`}
                  data-claim-id={item.claimId}
                >
                  <td className="px-4 py-3">
                    <AgeBadge seconds={age} />
                  </td>
                  <td className="px-4 py-3 font-medium">
                    <Link
                      to={`/claims/${item.claimId}`}
                      state={{ from: '/inbox' }}
                      onClick={(e) => e.stopPropagation()}
                      className="whitespace-nowrap text-indigo-700 hover:underline"
                      data-testid={`inbox-open-${item.claimId}`}
                    >
                      {item.claimNo}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-900">{item.employeeName}</td>
                  <td className="hidden px-4 py-3 text-slate-700 lg:table-cell">{item.department ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <Money value={item.totalAmount} />
                  </td>
                  <td className="px-4 py-3">
                    <FlagList flags={item.flags} sample={item.sampleAudit} />
                  </td>
                  <td className="px-4 py-3 text-slate-800">{LEVEL_LABEL[item.level]}</td>
                  <td className="hidden px-4 py-3 text-slate-700 xl:table-cell">{item.onBehalfOfName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="inbox-cards">
          {rows.map(({ item, age }, idx) => (
            <li key={`${item.claimId}-${item.level}`}>
              <Link
                to={`/claims/${item.claimId}`}
                state={{ from: '/inbox' }}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                data-testid={`inbox-card-${idx}`}
              >
                <AgeBadge seconds={age} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-slate-900">{item.employeeName}</span>
                    <Money value={item.totalAmount} strong />
                  </div>
                  <p className="text-xs text-slate-600">
                    {item.claimNo} · {LEVEL_LABEL[item.level]}
                    {item.onBehalfOfName ? ` · for ${item.onBehalfOfName}` : ''}
                  </p>
                  <div className="mt-1">
                    <FlagList flags={item.flags} sample={item.sampleAudit} />
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
