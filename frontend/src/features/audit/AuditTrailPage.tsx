import { Fragment, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { auditApi, type AuditFilters } from '@/api/audit';
import { authApi } from '@/api/auth';
import { qk } from '@/api/keys';
import type { AuditEvent } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorBanner, PageHeader, Pagination, SkeletonRows } from '@/components/ui/Display';
import { Field, Input, Select } from '@/components/ui/Field';
import { useDebounce, useIsTabletUp } from '@/hooks';
import { cn } from '@/utils/misc';
import { formatIST, todayIST } from '@/utils/time';

function prettyAction(a: string): string {
  return a.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function show(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** Field-by-field before → after diff; changed fields are highlighted. */
function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  const b = asRecord(before);
  const a = asRecord(after);
  if (!b && !a) {
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">
        {show(before)} → {show(after)}
      </pre>
    );
  }
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])].sort();
  return (
    <table className="w-full text-xs" data-testid="audit-diff">
      <thead className="text-left text-slate-600">
        <tr>
          <th scope="col" className="py-1 pr-3 font-semibold">Field</th>
          <th scope="col" className="py-1 pr-3 font-semibold">Before</th>
          <th scope="col" className="py-1 font-semibold">After</th>
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => {
          const bv = b?.[k];
          const av = a?.[k];
          const changed = JSON.stringify(bv) !== JSON.stringify(av);
          return (
            <tr key={k} className={cn(changed && 'bg-amber-50')}>
              <th scope="row" className="py-1 pr-3 text-left font-mono font-medium text-slate-800">
                {k}
              </th>
              <td className={cn('break-all py-1 pr-3 font-mono', changed ? 'text-red-800 line-through decoration-red-300' : 'text-slate-700')}>{show(bv)}</td>
              <td className={cn('break-all py-1 font-mono', changed ? 'font-semibold text-green-800' : 'text-slate-700')}>{show(av)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function AuditTrailPage() {
  const [sp, setSp] = useSearchParams();
  const tabletUp = useIsTabletUp();
  const [claimDraft, setClaimDraft] = useState(sp.get('claim') ?? '');
  const claim = useDebounce(claimDraft.trim(), 400);
  const actorId = sp.get('actorId') ?? '';
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const page = Number(sp.get('page') ?? '0') || 0;
  const [open, setOpen] = useState<Set<number>>(new Set());

  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n, { replace: true });
  };

  const filters: AuditFilters = {
    // Numeric input is the claim id; anything else (e.g. CLM-2026-0142) is sent as claimNo.
    claimId: /^\d+$/.test(claim) ? claim : undefined,
    claimNo: claim && !/^\d+$/.test(claim) ? claim : undefined,
    actorId: actorId || undefined,
    from: from ? `${from}T00:00:00+05:30` : undefined,
    to: to ? `${to}T23:59:59+05:30` : undefined,
    page,
  };

  const users = useQuery({ queryKey: qk.demoUsers, queryFn: authApi.demoUsers, staleTime: 10 * 60_000 });
  const sortedUsers = useMemo(() => [...(users.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [users.data]);

  const q = useQuery({
    queryKey: [...qk.audit, filters],
    queryFn: () => auditApi.list(filters),
    placeholderData: keepPreviousData,
  });
  const events = [...(q.data?.content ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const toggle = (id: number) =>
    setOpen((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const actor = (e: AuditEvent) => e.actorName ?? (e.actorId ? `#${e.actorId}` : 'System');
  const behalf = (e: AuditEvent) => e.onBehalfOfName ?? (e.onBehalfOfId ? `#${e.onBehalfOfId}` : null);

  return (
    <div>
      <PageHeader title="Audit trail" subtitle="Append-only record of every change. Read-only; times in IST." />

      <section className="mb-4 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm md:grid-cols-5" aria-label="Filters">
        <Field label="Claim no or ID" className="col-span-2 md:col-span-1">
          {(p) => <Input {...p} placeholder="CLM-2026-0142" value={claimDraft} onChange={(e) => setClaimDraft(e.target.value)} data-testid="audit-claim" />}
        </Field>
        <Field label="Actor" className="col-span-2 md:col-span-1">
          {(p) => (
            <Select {...p} value={actorId} onChange={(e) => setParam('actorId', e.target.value)} data-testid="audit-actor">
              <option value="">Anyone</option>
              {sortedUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="From">
          {(p) => <Input {...p} type="date" max={to || todayIST()} value={from} onChange={(e) => setParam('from', e.target.value)} data-testid="audit-from" />}
        </Field>
        <Field label="To">
          {(p) => <Input {...p} type="date" min={from} max={todayIST()} value={to} onChange={(e) => setParam('to', e.target.value)} data-testid="audit-to" />}
        </Field>
        <div className="col-span-2 flex items-end md:col-span-1">
          <Button
            variant="ghost"
            icon={<RotateCcw className="h-4 w-4" aria-hidden />}
            onClick={() => {
              setClaimDraft('');
              setSp(new URLSearchParams(), { replace: true });
            }}
            testId="audit-reset"
          >
            Reset
          </Button>
        </div>
      </section>

      {q.isPending ? (
        <SkeletonRows rows={10} />
      ) : q.isError ? (
        <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />
      ) : events.length === 0 ? (
        <EmptyState title="No audit events" description="No events match these filters." testId="audit-empty" />
      ) : tabletUp ? (
        <div className="ef-table-wrap ef-scroll">
          <table className="w-full text-sm" data-testid="audit-table">
            <thead className="ef-thead text-left font-semibold uppercase">
              <tr>
                <th scope="col" className="w-8 px-3 py-2">
                  <span className="sr-only">Expand</span>
                </th>
                <th scope="col" className="px-3 py-2">Time (IST)</th>
                <th scope="col" className="px-3 py-2">Actor</th>
                <th scope="col" className="px-3 py-2">On behalf of</th>
                <th scope="col" className="px-3 py-2">Entity</th>
                <th scope="col" className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 [&>tr:hover]:bg-slate-50/80">
              {events.map((e) => {
                const isOpen = open.has(e.id);
                return (
                  <Fragment key={e.id}>
                    <tr className="hover:bg-slate-50" data-testid={`audit-row-${e.id}`}>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-controls={`audit-diff-${e.id}`}
                          aria-label={isOpen ? 'Hide changes' : 'Show changes'}
                          onClick={() => toggle(e.id)}
                          className="rounded p-0.5 text-slate-600 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
                          data-testid={`audit-expand-${e.id}`}
                        >
                          {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-700">{formatIST(e.createdAt)}</td>
                      <td className="px-3 py-2 text-slate-900">{actor(e)}</td>
                      <td className="px-3 py-2 text-slate-700">{behalf(e) ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-700">
                        {e.entityType} #{e.entityId}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900">{prettyAction(e.action)}</td>
                    </tr>
                    {isOpen && (
                      <tr id={`audit-diff-${e.id}`} className="bg-slate-50/60">
                        <td />
                        <td colSpan={5} className="px-3 py-3">
                          <JsonDiff before={e.before} after={e.after} />
                          {e.requestId && <p className="mt-2 text-xs text-slate-500">Request {e.requestId}</p>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="space-y-2" data-testid="audit-cards">
          {events.map((e) => (
            <li key={e.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <p className="text-sm font-medium text-slate-900">{prettyAction(e.action)}</p>
              <p className="text-xs text-slate-600">
                {formatIST(e.createdAt)} · {e.entityType} #{e.entityId}
              </p>
              <p className="text-xs text-slate-700">
                by {actor(e)}
                {behalf(e) && ` on behalf of ${behalf(e)}`}
              </p>
              <details className="mt-1">
                <summary className="cursor-pointer text-xs font-medium text-indigo-700">Before → After</summary>
                <div className="mt-2 overflow-x-auto">
                  <JsonDiff before={e.before} after={e.after} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      {q.data && <Pagination page={q.data.page} totalPages={q.data.totalPages} totalElements={q.data.totalElements} onPage={(p) => setParam('page', String(p))} />}
    </div>
  );
}
