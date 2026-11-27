import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getCoreRowModel, useReactTable, type ColumnDef, type RowSelectionState } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, CheckCheck, CheckCircle2, RotateCcw, XCircle } from 'lucide-react';
import { auditorApi } from '@/api/auditor';
import { authApi } from '@/api/auth';
import { errorMessage } from '@/api/client';
import { qk } from '@/api/keys';
import { CATEGORIES, type AuditorQueueFilters, type AuditorQueueItem, type BulkApproveResult, type Category, type Flag, type QueueSort } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Badge, FlagList } from '@/components/ui/Chips';
import { DataTable } from '@/components/ui/DataTable';
import { AgeBadge, Banner, EmptyState, ErrorBanner, Money, PageHeader, Pagination, SkeletonRows } from '@/components/ui/Display';
import { Checkbox, Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useMe } from '@/features/auth/AuthContext';
import { hasRole } from '@/features/auth/permissions';
import { useDebounce, useIsTabletUp } from '@/hooks';
import { CATEGORY_LABEL, FLAG_LABEL, FLAGS_FILTERABLE } from '@/utils/labels';
import { formatINR, sumMoney } from '@/utils/money';
import { cn } from '@/utils/misc';
import { itemAge } from '@/utils/time';

const SORTS: readonly QueueSort[] = ['age', '-age', 'amount', '-amount'];
const MAX_BULK = 100;

function readFilters(sp: URLSearchParams): AuditorQueueFilters {
  const sort = sp.get('sort') as QueueSort | null;
  const category = sp.get('category');
  const flag = sp.get('flag');
  return {
    dept: sp.get('dept') ?? '',
    category: category && (CATEGORIES as readonly string[]).includes(category) ? (category as Category) : '',
    min: sp.get('min') ?? '',
    max: sp.get('max') ?? '',
    flag: flag && (FLAGS_FILTERABLE as readonly string[]).includes(flag) ? (flag as Flag) : '',
    sample: sp.get('sample') === 'true',
    ageDays: sp.get('ageDays') ?? '',
    sort: sort && SORTS.includes(sort) ? sort : '-age',
    page: Number(sp.get('page') ?? '0') || 0,
  };
}

function writeFilters(f: AuditorQueueFilters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.dept) sp.set('dept', f.dept);
  if (f.category) sp.set('category', f.category);
  if (f.min) sp.set('min', f.min);
  if (f.max) sp.set('max', f.max);
  if (f.flag) sp.set('flag', f.flag);
  if (f.sample) sp.set('sample', 'true');
  if (f.ageDays) sp.set('ageDays', f.ageDays);
  if (f.sort && f.sort !== '-age') sp.set('sort', f.sort);
  if (f.page) sp.set('page', String(f.page));
  return sp;
}

export default function AuditorQueuePage() {
  const me = useMe();
  const canBulk = hasRole(me, 'AUDITOR');
  const [sp, setSp] = useSearchParams();
  const filters = useMemo(() => readFilters(sp), [sp]);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const tabletUp = useIsTabletUp();

  // Amount fields are debounced so typing does not fire a query per keystroke.
  const [minDraft, setMinDraft] = useState(filters.min ?? '');
  const [maxDraft, setMaxDraft] = useState(filters.max ?? '');
  const [ageDraft, setAgeDraft] = useState(filters.ageDays ?? '');
  const dMin = useDebounce(minDraft, 400);
  const dMax = useDebounce(maxDraft, 400);
  const dAge = useDebounce(ageDraft, 400);

  const update = (patch: Partial<AuditorQueueFilters>) => {
    setSp(writeFilters({ ...filters, page: 0, ...patch }), { replace: true });
  };

  useEffect(() => {
    if (dMin !== (filters.min ?? '') || dMax !== (filters.max ?? '') || dAge !== (filters.ageDays ?? '')) {
      update({ min: dMin, max: dMax, ageDays: dAge });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dMin, dMax, dAge]);

  const users = useQuery({ queryKey: qk.demoUsers, queryFn: authApi.demoUsers, staleTime: 10 * 60_000 });
  const departments = useMemo(
    () => [...new Set((users.data ?? []).map((u) => u.department ?? u.departmentName).filter((d): d is string => !!d))].sort(),
    [users.data],
  );

  const q = useQuery({
    queryKey: [...qk.auditorQueue, filters],
    queryFn: () => auditorApi.queue(filters),
    placeholderData: keepPreviousData,
  });

  // ---- selection (kept across pages, keyed by claimId) ----
  const [selected, setSelected] = useState<Map<number, AuditorQueueItem>>(new Map());
  useEffect(() => {
    setSelected(new Map());
  }, [filters.dept, filters.category, filters.min, filters.max, filters.flag, filters.sample, filters.ageDays]);

  const rows = useMemo(() => q.data?.content ?? [], [q.data]);
  const rowSelection: RowSelectionState = useMemo(() => {
    const s: RowSelectionState = {};
    for (const r of rows) if (selected.has(r.claimId)) s[String(r.claimId)] = true;
    return s;
  }, [rows, selected]);

  const selectable = (r: AuditorQueueItem) => canBulk && r.employeeId !== me.id && (!r.status || r.status === 'PENDING_AUDITOR');

  const toggle = (r: AuditorQueueItem, on: boolean) =>
    setSelected((cur) => {
      const n = new Map(cur);
      if (on) n.set(r.claimId, r);
      else n.delete(r.claimId);
      return n;
    });

  const sortHeader = (label: string, key: 'age' | 'amount', align?: 'right') => {
    const asc = filters.sort === key;
    const desc = filters.sort === `-${key}`;
    const Icon = asc ? ArrowUp : desc ? ArrowDown : ArrowUpDown;
    return (
      <button
        type="button"
        onClick={() => update({ sort: desc ? (key as QueueSort) : (`-${key}` as QueueSort) })}
        className={cn('inline-flex items-center gap-1 uppercase hover:text-slate-900', align === 'right' && 'flex-row-reverse')}
        data-testid={`sort-${key}`}
      >
        {label}
        <Icon className="h-3 w-3" aria-hidden />
        <span className="sr-only">{asc ? 'sorted ascending' : desc ? 'sorted descending' : 'not sorted'}</span>
      </button>
    );
  };

  const columns = useMemo<ColumnDef<AuditorQueueItem>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Select all on this page"
            className="h-4 w-4"
            disabled={!canBulk}
            checked={table.getRowModel().rows.length > 0 && table.getRowModel().rows.filter((r) => r.getCanSelect()).every((r) => r.getIsSelected())}
            onChange={(e) => {
              for (const r of table.getRowModel().rows) if (r.getCanSelect()) toggle(r.original, e.target.checked);
            }}
            data-testid="select-all"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.original.claimNo}`}
            className="h-4 w-4"
            disabled={!row.getCanSelect()}
            checked={row.getIsSelected()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => toggle(row.original, e.target.checked)}
            data-testid={`select-${row.original.claimId}`}
          />
        ),
      },
      { id: 'age', header: () => sortHeader('Age', 'age'), cell: ({ row }) => <AgeBadge seconds={itemAge(row.original)} /> },
      {
        id: 'claimNo',
        header: 'Claim no',
        cell: ({ row }) => (
          <Link
            to={`/claims/${row.original.claimId}`}
            state={{ from: `/auditor?${sp.toString()}` }}
            onClick={(e) => e.stopPropagation()}
            className="whitespace-nowrap font-medium text-indigo-700 hover:underline"
            data-testid={`queue-open-${row.original.claimId}`}
          >
            {row.original.claimNo}
          </Link>
        ),
      },
      {
        id: 'employee',
        header: 'Employee',
        cell: ({ row }) => (
          <span className="whitespace-nowrap">
            {row.original.employeeName}
            {row.original.employeeId === me.id && (
              <span className="ml-1">
                <Badge>Your claim</Badge>
              </span>
            )}
          </span>
        ),
      },
      { id: 'dept', header: 'Dept', cell: ({ row }) => row.original.department ?? '—' },
      { id: 'lines', header: 'Lines', meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{row.original.lineCount ?? '—'}</span> },
      { id: 'total', header: () => sortHeader('Total', 'amount', 'right'), meta: { align: 'right' }, cell: ({ row }) => <Money value={row.original.totalAmount} /> },
      { id: 'flags', header: 'Flags', cell: ({ row }) => <FlagList flags={(row.original.flags ?? []).filter((f) => f !== 'SAMPLE')} /> },
      {
        id: 'sample',
        header: 'Sample',
        cell: ({ row }) =>
          row.original.sampleAudit ? (
            <span data-testid={`sample-badge-${row.original.claimId}`}>
              <Badge tone="violet">SAMPLE</Badge>
            </span>
          ) : null,
      },
      { id: 'mgr', header: 'Manager approved by', meta: { className: 'hidden xl:table-cell' }, cell: ({ row }) => row.original.managerApprovedBy ?? '—' },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters.sort, canBulk, me.id, sp],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => String(r.claimId),
    state: { rowSelection },
    enableRowSelection: (row) => selectable(row.original),
    manualPagination: true,
    manualSorting: true,
  });

  // ---- bulk approve ----
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [results, setResults] = useState<BulkApproveResult[] | null>(null);
  const selectedList = [...selected.values()];
  const selectedTotal = sumMoney(selectedList.map((s) => s.totalAmount));

  const bulk = useMutation({
    mutationFn: () => auditorApi.bulkApprove(selectedList.map((s) => ({ claimId: s.claimId, version: s.version }))),
    onSuccess: (res) => {
      setResults(res);
      const ok = res.filter(isOk).length;
      toast.show(`${ok} approved · ${res.length - ok} failed`, ok === res.length ? 'success' : 'info');
      void qc.invalidateQueries({ queryKey: qk.auditorQueue });
      void qc.invalidateQueries({ queryKey: qk.inbox });
      void qc.invalidateQueries({ queryKey: qk.claims });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  function closeBulk() {
    setConfirmOpen(false);
    if (results) {
      setSelected(new Map());
      setResults(null);
    }
  }

  const reset = () => {
    setMinDraft('');
    setMaxDraft('');
    setAgeDraft('');
    setSp(new URLSearchParams(), { replace: true });
  };

  return (
    <div className={cn(selected.size > 0 && 'pb-20')}>
      <PageHeader title="Auditor queue" subtitle="Claims waiting for audit, oldest first. 10% of auto-approved claims are sampled." />

      {/* filters */}
      <section className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm" aria-label="Filters" data-testid="queue-filters">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          <Field label="Department" className="col-span-2 md:col-span-1 xl:col-span-2">
            {(p) => (
              <Select {...p} value={filters.dept} onChange={(e) => update({ dept: e.target.value })} data-testid="filter-dept">
                <option value="">All departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Category">
            {(p) => (
              <Select {...p} value={filters.category} onChange={(e) => update({ category: e.target.value as Category | '' })} data-testid="filter-category">
                <option value="">All</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Flag">
            {(p) => (
              <Select {...p} value={filters.flag} onChange={(e) => update({ flag: e.target.value as Flag | '' })} data-testid="filter-flag">
                <option value="">Any</option>
                {FLAGS_FILTERABLE.map((f) => (
                  <option key={f} value={f}>
                    {FLAG_LABEL[f]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Min ₹">
            {(p) => (
              <Input {...p} inputMode="decimal" value={minDraft} onChange={(e) => setMinDraft(e.target.value.replace(/[^\d.]/g, ''))} data-testid="filter-min" />
            )}
          </Field>
          <Field label="Max ₹">
            {(p) => (
              <Input {...p} inputMode="decimal" value={maxDraft} onChange={(e) => setMaxDraft(e.target.value.replace(/[^\d.]/g, ''))} data-testid="filter-max" />
            )}
          </Field>
          <Field label="Age > days">
            {(p) => (
              <Input {...p} inputMode="numeric" value={ageDraft} onChange={(e) => setAgeDraft(e.target.value.replace(/\D/g, ''))} data-testid="filter-age" />
            )}
          </Field>
          <div className="col-span-2 flex items-end justify-between gap-2 md:col-span-1 xl:col-span-1 xl:flex-col xl:items-start">
            <Checkbox label="Sample only" checked={!!filters.sample} onChange={(e) => update({ sample: e.target.checked })} data-testid="filter-sample" />
            <Button size="sm" variant="ghost" icon={<RotateCcw className="h-4 w-4" aria-hidden />} onClick={reset} testId="filter-reset">
              Reset
            </Button>
          </div>
        </div>
      </section>

      {!canBulk && (
        <div className="mb-3">
          <Banner tone="info">Bulk approve is available to auditors. Finance heads can review and open claims from this queue.</Banner>
        </div>
      )}

      {q.data && (
        <p className="mb-2 text-sm text-slate-700" aria-live="polite" data-testid="queue-count">
          {q.data.totalElements} claim{q.data.totalElements === 1 ? '' : 's'} match
          {q.isFetching && !q.isPending && <span className="ml-2 text-slate-500">Updating…</span>}
        </p>
      )}

      {q.isPending ? (
        <SkeletonRows rows={10} />
      ) : q.isError ? (
        <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title="No claims match these filters" description="Change or reset the filters." action={<Button onClick={reset}>Reset filters</Button>} testId="queue-empty" />
      ) : tabletUp ? (
        <DataTable
          table={table}
          testId="queue-table"
          rowTestId={(r) => `queue-row-${r.claimId}`}
          onRowClick={(r) => navigate(`/claims/${r.claimId}`, { state: { from: `/auditor?${sp.toString()}` } })}
        />
      ) : (
        <ul className="space-y-2" data-testid="queue-cards">
          {rows.map((r) => (
            <li key={r.claimId} className={cn('flex gap-3 rounded-xl border bg-white p-3 shadow-sm', selected.has(r.claimId) ? 'border-indigo-500' : 'border-slate-200')}>
              <input
                type="checkbox"
                aria-label={`Select ${r.claimNo}`}
                className="mt-1 h-5 w-5"
                disabled={!selectable(r)}
                checked={selected.has(r.claimId)}
                onChange={(e) => toggle(r, e.target.checked)}
                data-testid={`m-select-${r.claimId}`}
              />
              <Link to={`/claims/${r.claimId}`} state={{ from: `/auditor?${sp.toString()}` }} className="min-w-0 flex-1" data-testid={`queue-card-${r.claimId}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-slate-900">{r.employeeName}</span>
                  <Money value={r.totalAmount} strong />
                </div>
                <p className="text-xs text-slate-600">
                  {r.claimNo} · {r.department ?? '—'}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <AgeBadge seconds={itemAge(r)} />
                  {r.sampleAudit && <Badge tone="violet">SAMPLE</Badge>}
                  <FlagList flags={(r.flags ?? []).filter((f) => f !== 'SAMPLE')} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {q.data && (
        <Pagination page={q.data.page} totalPages={q.data.totalPages} totalElements={q.data.totalElements} onPage={(p) => setSp(writeFilters({ ...filters, page: p }))} />
      )}

      {/* floating bulk bar */}
      {selected.size > 0 && (
        <div className="ef-toast fixed inset-x-0 bottom-14 z-20 px-4 pb-2 md:bottom-4 md:left-[var(--sidebar-w)] md:px-8" data-testid="bulk-bar">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-800 bg-slate-900/95 px-4 py-3 text-white shadow-2xl ring-1 ring-black/10 backdrop-blur">
            <span className="text-sm font-medium" aria-live="polite" data-testid="bulk-summary">
              {selected.size} selected · {formatINR(selectedTotal)}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={() => setSelected(new Map())} testId="bulk-clear">
                Clear
              </Button>
              <Button
                size="sm"
                variant="success"
                icon={<CheckCheck className="h-4 w-4" aria-hidden />}
                disabled={selected.size > MAX_BULK}
                onClick={() => setConfirmOpen(true)}
                testId="bulk-approve"
              >
                Bulk approve
              </Button>
            </div>
            {selected.size > MAX_BULK && <p className="w-full text-xs text-amber-200">You can approve at most {MAX_BULK} claims at once.</p>}
          </div>
        </div>
      )}

      <Modal
        open={confirmOpen}
        onClose={closeBulk}
        title={results ? 'Bulk approve results' : `Approve ${selected.size} claims?`}
        size="lg"
        testId="bulk-dialog"
        footer={
          results ? (
            <Button variant="primary" onClick={closeBulk} testId="bulk-done">
              Done
            </Button>
          ) : (
            <>
              <Button onClick={closeBulk} testId="bulk-cancel">
                Cancel
              </Button>
              <Button variant="success" loading={bulk.isPending} onClick={() => bulk.mutate()} testId="bulk-confirm">
                Approve {selected.size} · {formatINR(selectedTotal)}
              </Button>
            </>
          )
        }
      >
        {results ? (
          <div className="space-y-2">
            <p className="text-sm text-slate-700" data-testid="bulk-result-summary">
              {results.filter(isOk).length} approved, {results.filter((r) => !isOk(r)).length} failed.
            </p>
            <ul className="divide-y divide-slate-100" data-testid="bulk-results">
              {results.map((r) => {
                const item = selected.get(r.claimId);
                const ok = isOk(r);
                return (
                  <li key={r.claimId} className="flex items-start gap-2 py-2 text-sm" data-testid={`bulk-result-${r.claimId}`} data-ok={ok}>
                    {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-700" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 text-red-700" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{item?.claimNo ?? `#${r.claimId}`}</span> {item?.employeeName && `· ${item.employeeName}`}
                      {!ok && <span className="block text-xs text-red-800">{r.error ?? r.result}</span>}
                    </span>
                    <span className="sr-only">{ok ? 'approved' : 'failed'}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              {selected.size} claims, total <strong>{formatINR(selectedTotal)}</strong>. Each claim is approved separately; stale or self-owned claims fail
              without blocking the others.
            </p>
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200" data-testid="bulk-list">
              {selectedList.map((s) => (
                <li key={s.claimId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{s.claimNo}</span> · {s.employeeName}
                  </span>
                  <Money value={s.totalAmount} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  );
}

function isOk(r: BulkApproveResult): boolean {
  const v = r.result.toUpperCase();
  return !r.error && (v === 'APPROVED' || v === 'OK' || v === 'SUCCESS' || v.startsWith('PENDING') || v === 'ADVANCED');
}
