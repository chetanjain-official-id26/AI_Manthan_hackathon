import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Lock, Pencil, Undo2 } from 'lucide-react';
import { ApiError, errorMessage } from '@/api/client';
import { qk } from '@/api/keys';
import { policiesApi } from '@/api/policies';
import { claimsApi } from '@/api/claims';
import type { PolicyOutcome, PolicyRule, PolicyRuleVersionInput } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Badge, FlagChip, OutcomeBadge } from '@/components/ui/Chips';
import { Banner, EmptyState, ErrorBanner, Money, PageHeader, SkeletonRows } from '@/components/ui/Display';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useMe } from '@/features/auth/AuthContext';
import { hasRole } from '@/features/auth/permissions';
import { tierLabel } from '@/utils/cities';
import { CATEGORY_LABEL, FLAG_LABEL, OUTCOME_LABEL, ruleLabel } from '@/utils/labels';
import { useIsTabletUp } from '@/hooks';
import { isValidAmount } from '@/utils/money';
import { formatIST, localInputToISTInstant, nowISTLocalInput } from '@/utils/time';

const BLOCKED_MSG = 'You have a claim in flight, so rules cannot be edited until it is decided.';
const ACTIONS: PolicyOutcome[] = ['AUTO_APPROVE', 'ROUTE', 'AUTO_REJECT'];
const UNIT_LABEL: Record<string, string> = {
  PER_DAY: 'per day',
  PER_NIGHT: 'per night',
  PER_TRIP: 'per trip',
  PER_LINE: 'per line',
  NONE: '—',
};

/** A rule "slot" is (ruleCode, category, cityTier); versions increase within it. */
function slotKey(r: PolicyRule): string {
  return `${r.ruleCode}|${r.category ?? ''}|${r.cityTier ?? ''}`;
}

interface Slot {
  key: string;
  current: PolicyRule;
  history: PolicyRule[];
}

function buildSlots(rules: PolicyRule[]): Slot[] {
  const map = new Map<string, PolicyRule[]>();
  for (const r of rules) {
    const k = slotKey(r);
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  const slots: Slot[] = [];
  for (const [key, list] of map) {
    const history = [...list].sort((a, b) => b.version - a.version);
    const current = history.find((r) => r.active) ?? history[0];
    if (current) slots.push({ key, current, history });
  }
  return slots.sort((a, b) => a.key.localeCompare(b.key));
}

type EditState = { slot: Slot; rollbackFrom?: PolicyRule } | null;

export default function PolicyRulesPage() {
  const me = useMe();
  const canEdit = hasRole(me, 'FINANCE_HEAD');
  const tabletUp = useIsTabletUp();
  const [editing, setEditing] = useState<EditState>(null);
  const [historyFor, setHistoryFor] = useState<Slot | null>(null);
  const [blocked, setBlocked] = useState(false);

  const q = useQuery({ queryKey: qk.policies, queryFn: () => policiesApi.list(true) });

  // R7: the finance head may not edit rules while one of their own claims is in flight.
  // The server enforces this with 409; this pre-check only disables the controls up front.
  const inFlight = useQuery({
    queryKey: [...qk.claims, 'in-flight', me.id],
    enabled: canEdit,
    queryFn: async () => {
      const statuses = ['SUBMITTED', 'PENDING_MANAGER', 'PENDING_AUDITOR', 'PENDING_FINANCE_HEAD'] as const;
      const pages = await Promise.all(statuses.map((status) => claimsApi.list({ mine: true, status, page: 0 })));
      return pages.reduce((n, p) => n + p.totalElements, 0);
    },
  });
  const editBlocked = blocked || (inFlight.data ?? 0) > 0;
  const slots = useMemo(() => buildSlots(q.data ?? []), [q.data]);

  return (
    <div className="space-y-4">
      <PageHeader title="Policy rules" subtitle="Limits and actions the policy engine applies to every line" />
      <Banner tone="info" testId="policy-banner">
        Changes apply to new submissions only. Each save creates a new version; claims already submitted keep the version they were checked against.
      </Banner>
      {!canEdit && <Banner tone="info">Read-only: only the Finance Head can change rules.</Banner>}
      {editBlocked && (
        <Banner tone="warning" title="Editing blocked" testId="policy-blocked">
          {BLOCKED_MSG}
        </Banner>
      )}

      {q.isPending ? (
        <SkeletonRows rows={8} />
      ) : q.isError ? (
        <ErrorBanner error={q.error} onRetry={() => void q.refetch()} />
      ) : slots.length === 0 ? (
        <EmptyState title="No policy rules" description="Seed the policy_rule table." testId="policies-empty" />
      ) : !tabletUp ? (
        <ul className="space-y-2" data-testid="policy-cards">
          {slots.map((s) => {
            const r = s.current;
            return (
              <li key={s.key} className="rounded-xl border border-slate-200/80 bg-white p-3 shadow-xs" data-testid={`policy-card-${r.ruleCode}${r.cityTier ? `-${r.cityTier}` : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{ruleLabel(r.ruleCode)}</p>
                    <p className="text-xs text-slate-500">
                      {r.category ? CATEGORY_LABEL[r.category] : 'All categories'} · {r.cityTier ? tierLabel(r.cityTier) : 'any city'} · v{r.version}
                    </p>
                  </div>
                  <OutcomeBadge outcome={r.action} />
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">
                    {r.limitAmount != null ? (
                      <>
                        <Money value={r.limitAmount} strong /> <span className="text-xs text-slate-500">{UNIT_LABEL[r.unit] ?? ''}</span>
                      </>
                    ) : (
                      <span className="text-xs text-slate-500">No limit · {r.flag ? FLAG_LABEL[r.flag] : 'check only'}</span>
                    )}
                  </span>
                  <div className="flex gap-1">
                    {canEdit && (
                      <Button size="sm" disabled={editBlocked} icon={<Pencil className="h-3.5 w-3.5" aria-hidden />} onClick={() => setEditing({ slot: s })} testId={`m-policy-edit-${s.key}`}>
                        Edit
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" icon={<History className="h-3.5 w-3.5" aria-hidden />} onClick={() => setHistoryFor(s)} testId={`m-policy-history-${s.key}`}>
                      History
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="ef-table-wrap ef-scroll">
          <table className="w-full min-w-[760px] text-sm" data-testid="policy-table">
            <thead className="ef-thead text-left font-semibold uppercase">
              <tr>
                <th scope="col" className="px-3 py-2">Rule</th>
                <th scope="col" className="px-3 py-2">Category</th>
                <th scope="col" className="px-3 py-2">Tier</th>
                <th scope="col" className="px-3 py-2 text-right">Limit</th>
                <th scope="col" className="px-3 py-2">Unit</th>
                <th scope="col" className="px-3 py-2">Action</th>
                <th scope="col" className="px-3 py-2 text-right">Version</th>
                <th scope="col" className="px-3 py-2">Effective from</th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 [&>tr:hover]:bg-slate-50/80">
              {slots.map((s) => {
                const r = s.current;
                return (
                  <tr key={s.key} data-testid={`policy-row-${r.ruleCode}${r.cityTier ? `-${r.cityTier}` : ''}`}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-900">{ruleLabel(r.ruleCode)}</p>
                      <p className="flex flex-wrap items-center gap-1 font-mono text-xs text-slate-600">
                        {r.ruleCode}
                        {r.flag && <FlagChip flag={r.flag} />}
                        {!r.active && <Badge>Inactive</Badge>}
                      </p>
                    </td>
                    <td className="px-3 py-2">{r.category ? CATEGORY_LABEL[r.category] : 'All'}</td>
                    <td className="px-3 py-2">{r.cityTier ? tierLabel(r.cityTier) : 'Any'}</td>
                    <td className="px-3 py-2 text-right">{r.limitAmount != null ? <Money value={r.limitAmount} /> : '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{UNIT_LABEL[r.unit] ?? r.unit}</td>
                    <td className="px-3 py-2">
                      <OutcomeBadge outcome={r.action} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">v{r.version}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-700">{formatIST(r.effectiveFrom)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {canEdit && (
                          <Button size="sm" disabled={editBlocked} icon={<Pencil className="h-3.5 w-3.5" aria-hidden />} onClick={() => setEditing({ slot: s })} testId={`policy-edit-${s.key}`}>
                            Edit
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" icon={<History className="h-3.5 w-3.5" aria-hidden />} onClick={() => setHistoryFor(s)} testId={`policy-history-${s.key}`}>
                          History
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <EditRuleModal
          key={`${editing.slot.key}-${editing.rollbackFrom?.version ?? 'edit'}`}
          state={editing}
          onClose={() => setEditing(null)}
          onBlocked={() => {
            setBlocked(true);
            setEditing(null);
          }}
        />
      )}

      <Modal open={!!historyFor} onClose={() => setHistoryFor(null)} title={historyFor ? `History · ${ruleLabel(historyFor.current.ruleCode)}` : 'History'} variant="drawer" testId="policy-history">
        {historyFor && (
          <ol className="space-y-3">
            {historyFor.history.map((v) => {
              const isCurrent = v.id === historyFor.current.id;
              return (
                <li key={v.id} className="rounded-lg border border-slate-200 p-3" data-testid={`policy-version-${v.version}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-slate-900">
                      v{v.version} {isCurrent && <Badge tone="indigo">Current</Badge>} {!v.active && !isCurrent && <Badge>Inactive</Badge>}
                    </p>
                    {canEdit && !isCurrent && (
                      <Button
                        size="sm"
                        disabled={editBlocked}
                        icon={<Undo2 className="h-3.5 w-3.5" aria-hidden />}
                        onClick={() => {
                          setEditing({ slot: historyFor, rollbackFrom: v });
                          setHistoryFor(null);
                        }}
                        testId={`policy-rollback-${v.version}`}
                      >
                        Roll back to this version
                      </Button>
                    )}
                  </div>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                    <dt className="text-slate-600">Limit</dt>
                    <dd>{v.limitAmount != null ? <Money value={v.limitAmount} /> : '—'}</dd>
                    <dt className="text-slate-600">Action</dt>
                    <dd>{OUTCOME_LABEL[v.action]}</dd>
                    <dt className="text-slate-600">Effective</dt>
                    <dd>{formatIST(v.effectiveFrom)}</dd>
                    <dt className="text-slate-600">By</dt>
                    <dd>
                      {v.createdByName ?? '—'}
                      {v.createdAt ? ` · ${formatIST(v.createdAt)}` : ''}
                    </dd>
                    {v.reason && (
                      <>
                        <dt className="text-slate-600">Reason</dt>
                        <dd className="italic">“{v.reason}”</dd>
                      </>
                    )}
                  </dl>
                </li>
              );
            })}
          </ol>
        )}
      </Modal>
    </div>
  );
}

function EditRuleModal({ state, onClose, onBlocked }: { state: NonNullable<EditState>; onClose: () => void; onBlocked: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const base = state.rollbackFrom ?? state.slot.current;
  const hasLimit = state.slot.current.limitAmount != null || base.limitAmount != null;

  const [limit, setLimit] = useState(base.limitAmount != null ? String(base.limitAmount) : '');
  const [action, setAction] = useState<PolicyOutcome>(base.action);
  const [active, setActive] = useState(state.rollbackFrom ? true : base.active);
  const [effective, setEffective] = useState(nowISTLocalInput());
  const [reason, setReason] = useState(state.rollbackFrom ? `Roll back to v${state.rollbackFrom.version}: ` : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (input: PolicyRuleVersionInput) => policiesApi.createVersion(state.slot.current.ruleCode, input),
    onSuccess: async (rule) => {
      toast.success(`${ruleLabel(rule.ruleCode)} saved as v${rule.version}`);
      await qc.invalidateQueries({ queryKey: qk.policies });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.isConflict) {
        const d = (e.problem.detail ?? '').toLowerCase();
        if (!d || d.includes('claim') || d.includes('flight')) {
          onBlocked();
          return;
        }
        setGeneral('This rule was changed by someone else. Close and reopen to see the latest version.');
        return;
      }
      if (e instanceof ApiError && e.isValidation) {
        setErrors(e.fieldErrors);
        setGeneral(Object.keys(e.fieldErrors).length ? null : errorMessage(e));
        return;
      }
      setGeneral(errorMessage(e));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (hasLimit && !isValidAmount(limit)) errs.limitAmount = 'Enter a positive amount with at most 2 decimals.';
    if (!effective) errs.effectiveFrom = 'Choose when this version takes effect.';
    if (reason.trim().length < 3) errs.reason = 'A reason is required for every rule change.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate({
      limitAmount: hasLimit ? limit.trim() : null,
      action,
      active,
      effectiveFrom: localInputToISTInstant(effective),
      reason: reason.trim(),
      category: state.slot.current.category ?? null,
      cityTier: state.slot.current.cityTier ?? null,
    });
  }

  const r = state.slot.current;
  const title = state.rollbackFrom ? `Roll back ${ruleLabel(r.ruleCode)} to v${state.rollbackFrom.version}` : `Edit ${ruleLabel(r.ruleCode)}`;

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="md"
      testId="policy-edit-dialog"
      footer={
        <>
          <Button onClick={onClose} testId="policy-edit-cancel">
            Cancel
          </Button>
          <Button type="submit" form="policy-edit-form" variant="primary" loading={save.isPending} testId="policy-edit-save">
            Save as v{Math.max(...state.slot.history.map((h) => h.version)) + 1}
          </Button>
        </>
      }
    >
      <form id="policy-edit-form" onSubmit={submit} noValidate className="space-y-3">
        <p className="text-xs text-slate-600">
          {r.category ? CATEGORY_LABEL[r.category] : 'All categories'} · {r.cityTier ? tierLabel(r.cityTier) : 'any city'} · current v{r.version}
        </p>
        {general && (
          <Banner tone="error" testId="policy-edit-error">
            {general}
          </Banner>
        )}
        {hasLimit && (
          <Field label={`Limit (₹ ${UNIT_LABEL[r.unit] ?? ''})`} required error={errors.limitAmount} testId="policy-limit">
            {(p) => (
              <Input {...p} inputMode="decimal" className="text-right tabular-nums" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^\d.]/g, ''))} data-testid="policy-limit" />
            )}
          </Field>
        )}
        <Field label="Action when the rule fires" required error={errors.action} testId="policy-action">
          {(p) => (
            <Select {...p} value={action} onChange={(e) => setAction(e.target.value as PolicyOutcome)} data-testid="policy-action">
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {OUTCOME_LABEL[a]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Checkbox label="Rule is active" checked={active} onChange={(e) => setActive(e.target.checked)} data-testid="policy-active" />
        <Field label="Effective from (IST)" required error={errors.effectiveFrom} testId="policy-effective">
          {(p) => <Input {...p} type="datetime-local" value={effective} onChange={(e) => setEffective(e.target.value)} data-testid="policy-effective" />}
        </Field>
        <Field label="Reason for change" required error={errors.reason} hint="Stored in the audit trail with before and after values." testId="policy-reason">
          {(p) => <Textarea {...p} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="policy-reason" />}
        </Field>
        <p className="flex items-center gap-1 text-xs text-slate-600">
          <Lock className="h-3 w-3" aria-hidden /> Old versions are never changed; history moves forward.
        </p>
      </form>
    </Modal>
  );
}
