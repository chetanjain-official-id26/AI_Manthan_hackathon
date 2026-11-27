import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { delegationsApi, type DelegationInput } from '@/api/approvals';
import { authApi } from '@/api/auth';
import { ApiError, errorMessage } from '@/api/client';
import { qk } from '@/api/keys';
import type { Delegation } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Chips';
import { Banner, Card, EmptyState, ErrorBanner, PageHeader, SkeletonRows } from '@/components/ui/Display';
import { Field, Input, Select } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth, useMe } from '@/features/auth/AuthContext';
import { ROLE_LABEL } from '@/utils/labels';
import { formatISTDate, todayIST } from '@/utils/time';

type FormErrors = Partial<Record<'delegateId' | 'fromDate' | 'toDate' | 'reason', string>>;

function statusOf(d: Delegation, today: string): { label: string; tone: 'indigo' | 'violet' | 'slate' } {
  if (d.revoked) return { label: 'Revoked', tone: 'slate' };
  if (d.toDate < today) return { label: 'Expired', tone: 'slate' };
  if (d.fromDate > today) return { label: 'Scheduled', tone: 'violet' };
  return { label: 'Active', tone: 'indigo' };
}

/** Maps server problem text to friendlier copy for the known 422 cases. */
function friendly(e: unknown): string {
  const msg = errorMessage(e);
  const low = msg.toLowerCase();
  if (low.includes('cycle') || low.includes('loop')) return 'Would create a delegation loop (they already delegate to you, directly or through others).';
  if (low.includes('overlap')) return 'Dates overlap an existing delegation.';
  if (low.includes('self')) return 'You cannot delegate to yourself.';
  return msg;
}

export default function DelegationPage() {
  const me = useMe();
  const { refetchMe } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const today = todayIST();

  const [search, setSearch] = useState('');
  const [form, setForm] = useState<{ delegateId: string; fromDate: string; toDate: string; reason: string }>({
    delegateId: '',
    fromDate: today,
    toDate: today,
    reason: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Delegation | null>(null);

  const users = useQuery({ queryKey: qk.demoUsers, queryFn: authApi.demoUsers, staleTime: 10 * 60_000 });
  const list = useQuery({ queryKey: qk.delegations, queryFn: delegationsApi.list });

  const candidates = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (users.data ?? [])
      .filter((u) => u.id !== me.id)
      .filter((u) => !s || [u.name, u.department, u.departmentName, u.empCode].some((f) => f?.toLowerCase().includes(s)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 100);
  }, [users.data, search, me.id]);

  const create = useMutation({
    mutationFn: (input: DelegationInput) => delegationsApi.create(input),
    onSuccess: async () => {
      toast.success('Delegation created');
      setForm({ delegateId: '', fromDate: today, toDate: today, reason: '' });
      setSearch('');
      setServerError(null);
      await qc.invalidateQueries({ queryKey: qk.delegations });
      refetchMe();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.isValidation) {
        setErrors(e.fieldErrors as FormErrors);
        setServerError(friendly(e));
      } else setServerError(errorMessage(e));
    },
  });

  const revoke = useMutation({
    mutationFn: (id: number) => delegationsApi.revoke(id),
    onSuccess: async () => {
      toast.success('Delegation revoked');
      setRevoking(null);
      await qc.invalidateQueries({ queryKey: qk.delegations });
      refetchMe();
    },
    onError: (e) => {
      setRevoking(null);
      toast.error(errorMessage(e));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const errs: FormErrors = {};
    if (!form.delegateId) errs.delegateId = 'Choose who will approve for you.';
    if (!form.fromDate) errs.fromDate = 'Choose a start date.';
    else if (form.fromDate < today) errs.fromDate = 'Start date cannot be in the past.';
    if (!form.toDate) errs.toDate = 'Choose an end date.';
    else if (form.fromDate && form.toDate < form.fromDate) errs.toDate = 'End date must be on or after the start date.';
    if (!form.reason.trim()) errs.reason = 'Give a reason, e.g. “Annual leave”.';
    setErrors(errs);
    setServerError(null);
    if (Object.keys(errs).length) return;
    create.mutate({ delegateId: Number(form.delegateId), fromDate: form.fromDate, toDate: form.toDate, reason: form.reason.trim() });
  }

  const rows = [...(list.data ?? [])].sort((a, b) => b.fromDate.localeCompare(a.fromDate));

  return (
    <div className="space-y-6">
      <PageHeader title="Delegation" subtitle="Let a colleague approve on your behalf while you are on leave" />

      <Card title="New delegation">
        <form onSubmit={submit} noValidate className="grid gap-4 md:grid-cols-2" data-testid="delegation-form">
          {serverError && (
            <div className="md:col-span-2">
              <Banner tone="error" testId="delegation-error">
                {serverError}
              </Banner>
            </div>
          )}
          <div className="space-y-2 md:col-span-2">
            <Field label="Search colleagues" testId="delegate-search">
              {(p) => (
                <Input
                  {...p}
                  type="search"
                  placeholder="Name, department or employee code"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="delegate-search"
                />
              )}
            </Field>
            <Field label="Delegate" required error={errors.delegateId} hint="You cannot pick yourself." testId="delegate-select">
              {(p) => (
                <Select
                  {...p}
                  value={form.delegateId}
                  onChange={(e) => setForm((f) => ({ ...f, delegateId: e.target.value }))}
                  disabled={users.isPending}
                  data-testid="delegate-select"
                >
                  <option value="">{users.isPending ? 'Loading…' : `Select a colleague (${candidates.length})`}</option>
                  {candidates.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {u.department ?? u.departmentName ?? '—'} ({u.roles.map((r) => ROLE_LABEL[r]).join(', ')})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="From" required error={errors.fromDate} testId="delegation-from">
            {(p) => (
              <Input
                {...p}
                type="date"
                min={today}
                value={form.fromDate}
                onChange={(e) => setForm((f) => ({ ...f, fromDate: e.target.value }))}
                data-testid="delegation-from"
              />
            )}
          </Field>
          <Field label="To" required error={errors.toDate} testId="delegation-to">
            {(p) => (
              <Input
                {...p}
                type="date"
                min={form.fromDate || today}
                value={form.toDate}
                onChange={(e) => setForm((f) => ({ ...f, toDate: e.target.value }))}
                data-testid="delegation-to"
              />
            )}
          </Field>
          <Field label="Reason" required error={errors.reason} className="md:col-span-2" testId="delegation-reason">
            {(p) => (
              <Input
                {...p}
                maxLength={200}
                placeholder="Annual leave"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                data-testid="delegation-reason"
              />
            )}
          </Field>
          <div className="md:col-span-2">
            <Button type="submit" variant="primary" icon={<UserPlus className="h-4 w-4" aria-hidden />} loading={create.isPending} testId="delegation-submit">
              Create delegation
            </Button>
            <p className="mt-2 text-xs text-slate-600">
              Your delegate sees and acts on your pending steps only while the delegation is active. Delegation does not chain, and nobody can approve their
              own claim.
            </p>
          </div>
        </form>
      </Card>

      <Card title="Your delegations">
        {list.isPending ? (
          <SkeletonRows rows={3} />
        ) : list.isError ? (
          <ErrorBanner error={list.error} onRetry={() => void list.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="No delegations" description="Delegations you create, or that name you as a delegate, show here." testId="delegations-empty" />
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="delegations-list">
            {rows.map((d) => {
              const st = statusOf(d, today);
              const mine = d.delegatorId === me.id;
              return (
                <li key={d.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`delegation-${d.id}`}>
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-slate-900">
                      {mine ? (
                        <>
                          You → {d.delegateName ?? `#${d.delegateId}`}
                        </>
                      ) : (
                        <>
                          {d.delegatorName ?? `#${d.delegatorId}`} → you
                        </>
                      )}{' '}
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </p>
                    <p className="text-xs text-slate-600">
                      {formatISTDate(d.fromDate)} – {formatISTDate(d.toDate)}
                      {d.reason ? ` · ${d.reason}` : ''}
                    </p>
                  </div>
                  {mine && (st.label === 'Active' || st.label === 'Scheduled') && (
                    <Button size="sm" variant="danger" onClick={() => setRevoking(d)} testId={`delegation-revoke-${d.id}`}>
                      Revoke
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Modal
        open={!!revoking}
        onClose={() => setRevoking(null)}
        title="Revoke delegation?"
        size="sm"
        testId="revoke-dialog"
        footer={
          <>
            <Button onClick={() => setRevoking(null)} testId="revoke-cancel">
              Keep
            </Button>
            <Button variant="danger" loading={revoke.isPending} onClick={() => revoking && revoke.mutate(revoking.id)} testId="revoke-confirm">
              Revoke
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          {revoking?.delegateName ?? 'Your delegate'} will immediately lose access to your pending approvals.
        </p>
      </Modal>
    </div>
  );
}
