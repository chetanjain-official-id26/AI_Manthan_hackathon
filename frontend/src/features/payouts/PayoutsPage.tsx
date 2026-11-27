import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCoreRowModel, useReactTable, type ColumnDef, type RowSelectionState } from '@tanstack/react-table';
import { Plus, Wallet } from 'lucide-react';
import { ApiError, errorMessage } from '@/api/client';
import { qk } from '@/api/keys';
import { payoutsApi } from '@/api/payouts';
import type { ClaimSummary, PayoutBatch } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { PayoutStatusChip } from '@/components/ui/Chips';
import { DataTable } from '@/components/ui/DataTable';
import { Banner, Card, EmptyState, ErrorBanner, Money, PageHeader, SkeletonRows, Stat } from '@/components/ui/Display';
import { useToast } from '@/components/ui/Toast';
import { useIsTabletUp } from '@/hooks';
import { formatINR, sumMoney } from '@/utils/money';
import { cn } from '@/utils/misc';
import { formatIST, formatISTDate } from '@/utils/time';

type View = 'batches' | 'new';

export default function PayoutsPage() {
  const [view, setView] = useState<View>('batches');
  return (
    <div>
      <PageHeader
        title="Payouts"
        subtitle="Bundle approved claims into a batch, export the bank CSV, then mark it paid"
        actions={
          view === 'batches' ? (
            <Button variant="primary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setView('new')} testId="new-batch">
              New batch
            </Button>
          ) : (
            <Button onClick={() => setView('batches')} testId="back-to-batches">
              Back to batches
            </Button>
          )
        }
      />
      {view === 'batches' ? <BatchList onNew={() => setView('new')} /> : <CreateBatch />}
    </div>
  );
}

function BatchList({ onNew }: { onNew: () => void }) {
  const navigate = useNavigate();
  const tabletUp = useIsTabletUp();
  const q = useQuery({ queryKey: qk.payouts, queryFn: payoutsApi.list });

  if (q.isPending) return <SkeletonRows />;
  if (q.isError) return <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />;
  const rows = [...q.data].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id - a.id);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Wallet className="h-10 w-10" aria-hidden />}
        title="No payout batches yet"
        description="Create a batch from approved claims."
        action={
          <Button variant="primary" onClick={onNew} testId="empty-new-batch">
            New batch
          </Button>
        }
        testId="batches-empty"
      />
    );
  }

  if (!tabletUp) {
    return (
      <ul className="space-y-2" data-testid="batch-cards">
        {rows.map((b) => (
          <li key={b.id}>
            <Link to={`/payouts/${b.id}`} className="block rounded-xl border border-slate-200 bg-white p-3 shadow-sm" data-testid={`batch-card-${b.id}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-900">{b.batchNo}</span>
                <PayoutStatusChip status={b.status} />
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-slate-600">
                <span>
                  {b.claimCount} claims · {formatISTDate(b.createdAt)}
                </span>
                <Money value={b.totalAmount} strong className="text-sm text-slate-900" />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="ef-table-wrap ef-scroll">
      <table className="w-full text-sm" data-testid="batches-table">
        <thead className="ef-thead text-left font-semibold uppercase">
          <tr>
            <th scope="col" className="px-4 py-3">Batch no</th>
            <th scope="col" className="px-4 py-3">Created</th>
            <th scope="col" className="px-4 py-3 text-right">Claims</th>
            <th scope="col" className="px-4 py-3 text-right">Employees</th>
            <th scope="col" className="px-4 py-3 text-right">Total</th>
            <th scope="col" className="px-4 py-3">Status</th>
            <th scope="col" className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 [&>tr:hover]:bg-slate-50/80">
          {rows.map((b: PayoutBatch) => (
            <tr key={b.id} className="cursor-pointer hover:bg-slate-50" onClick={() => navigate(`/payouts/${b.id}`)} data-testid={`batch-row-${b.id}`}>
              <td className="px-4 py-3 font-medium text-indigo-800">{b.batchNo}</td>
              <td className="px-4 py-3 text-slate-700">{formatIST(b.createdAt)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{b.claimCount}</td>
              <td className="px-4 py-3 text-right tabular-nums">{b.employeeCount ?? '—'}</td>
              <td className="px-4 py-3 text-right">
                <Money value={b.totalAmount} />
              </td>
              <td className="px-4 py-3">
                <PayoutStatusChip status={b.status} />
              </td>
              <td className="px-4 py-3">
                <Link
                  to={`/payouts/${b.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm font-medium text-indigo-700 hover:underline"
                  data-testid={`batch-open-${b.id}`}
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreateBatch() {
  const tabletUp = useIsTabletUp();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({ queryKey: qk.eligible, queryFn: payoutsApi.eligible });
  const rows = useMemo(() => q.data ?? [], [q.data]);

  const columns = useMemo<ColumnDef<ClaimSummary>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            className="h-4 w-4"
            aria-label="Select all approved claims"
            checked={table.getIsAllRowsSelected()}
            ref={(el) => {
              if (el) el.indeterminate = table.getIsSomeRowsSelected();
            }}
            onChange={table.getToggleAllRowsSelectedHandler()}
            data-testid="eligible-select-all"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            className="h-4 w-4"
            aria-label={`Select ${row.original.claimNo}`}
            checked={row.getIsSelected()}
            onClick={(e) => e.stopPropagation()}
            onChange={row.getToggleSelectedHandler()}
            data-testid={`eligible-select-${row.original.id}`}
          />
        ),
      },
      { id: 'claim', header: 'Claim', cell: ({ row }) => <span className="font-medium">{row.original.claimNo}</span> },
      { id: 'employee', header: 'Employee', cell: ({ row }) => row.original.employeeName ?? `#${row.original.employeeId ?? '—'}` },
      { id: 'dept', header: 'Dept', meta: { className: 'hidden md:table-cell' }, cell: ({ row }) => row.original.department ?? '—' },
      { id: 'approved', header: 'Submitted', meta: { className: 'hidden lg:table-cell' }, cell: ({ row }) => formatISTDate(row.original.submittedAt) },
      { id: 'total', header: 'Total', meta: { align: 'right' }, cell: ({ row }) => <Money value={row.original.totalAmount} /> },
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => String(r.id),
    state: { rowSelection: selection },
    onRowSelectionChange: setSelection,
    enableRowSelection: true,
  });

  const chosen = rows.filter((r) => selection[String(r.id)]);
  const total = sumMoney(chosen.map((c) => c.totalAmount));
  const employees = new Set(chosen.map((c) => c.employeeId ?? c.employeeName)).size;

  const create = useMutation({
    mutationFn: () => payoutsApi.create(chosen.map((c) => c.id)),
    onSuccess: (batch) => {
      toast.success(`Batch ${batch.batchNo} created · ${batch.claimCount} claims in payout`);
      void qc.invalidateQueries({ queryKey: qk.payouts });
      void qc.invalidateQueries({ queryKey: qk.claims });
      navigate(`/payouts/${batch.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.isConflict) {
        setError('One or more claims are already in another batch. The list has been refreshed.');
        setSelection({});
        void q.refetch();
      } else setError(errorMessage(e));
    },
  });

  if (q.isPending) return <SkeletonRows />;
  if (q.isError) return <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />;
  if (rows.length === 0) return <EmptyState title="No approved claims to pay" description="Claims appear here once they are fully approved." testId="eligible-empty" />;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-3">
        {error && (
          <Banner tone="error" testId="create-batch-error">
            {error}
          </Banner>
        )}
        {!tabletUp ? (
          <ul className="space-y-2" data-testid="eligible-cards">
            {rows.map((r) => {
              const on = !!selection[String(r.id)];
              return (
                <li key={r.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-xl border bg-white p-3 shadow-xs transition-colors',
                      on ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200/80',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={on}
                      onChange={() => setSelection((s) => ({ ...s, [String(r.id)]: !s[String(r.id)] }))}
                      data-testid={`m-eligible-select-${r.id}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-slate-900">{r.employeeName ?? `#${r.employeeId ?? '—'}`}</span>
                        <Money value={r.totalAmount} strong />
                      </span>
                      <span className="block text-xs text-slate-500">
                        {r.claimNo} · {r.department ?? '—'}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
        <DataTable
          table={table}
          testId="eligible-table"
          rowTestId={(r) => `eligible-row-${r.id}`}
          onRowClick={(r) => setSelection((s) => ({ ...s, [String(r.id)]: !s[String(r.id)] }))}
        />
        )}
      </div>
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Card title="Batch preview">
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-1" data-testid="batch-preview">
            <Stat label="Claims" value={chosen.length} testId="preview-claims" />
            <Stat label="Employees" value={employees} testId="preview-employees" />
            <Stat label="Total" value={<span className="text-xl">{formatINR(total)}</span>} testId="preview-total" />
          </div>
          <Button
            variant="primary"
            size="lg"
            className={cn('mt-4 w-full')}
            disabled={chosen.length === 0}
            loading={create.isPending}
            onClick={() => {
              setError(null);
              create.mutate();
            }}
            testId="create-batch"
          >
            Create batch
          </Button>
          <p className="mt-2 text-xs text-slate-600">Claims move to “In payout”. You can void the batch until it is marked paid.</p>
        </Card>
      </aside>
    </div>
  );
}
