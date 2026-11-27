import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BarChart3,
  ClipboardCheck,
  FilePlus2,
  FileText,
  Inbox,
  RotateCcw,
  ScrollText,
  Settings2,
  ShieldCheck,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { approvalsApi, delegationsApi } from '@/api/approvals';
import { auditorApi } from '@/api/auditor';
import { claimsApi } from '@/api/claims';
import { qk } from '@/api/keys';
import { payoutsApi } from '@/api/payouts';
import type { ClaimStatus } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { RoleBadge } from '@/components/ui/Chips';
import { AgeBadge, Banner, Skeleton } from '@/components/ui/Display';
import { useMe } from '@/features/auth/AuthContext';
import { actingFor, hasRole, isApprover, isDelegationActive, primaryRole } from '@/features/auth/permissions';
import { formatINR, sumMoney } from '@/utils/money';
import { cn } from '@/utils/misc';
import { formatISTDate, itemAge } from '@/utils/time';

function useClaimCount(status: ClaimStatus) {
  return useQuery({
    queryKey: [...qk.claims, 'count', status],
    queryFn: () => claimsApi.list({ mine: true, status, page: 0 }),
    select: (p) => p.totalElements,
  });
}

function TaskCard({
  icon: Icon,
  title,
  value,
  hint,
  to,
  cta,
  tone = 'default',
  testId,
}: {
  icon: LucideIcon;
  title: string;
  value: ReactNode;
  hint?: ReactNode;
  to: string;
  cta: string;
  tone?: 'default' | 'attention';
  testId: string;
}) {
  return (
    <Link
      to={to}
      data-testid={testId}
      className={cn(
        'group flex flex-col justify-between gap-3 rounded-xl border bg-white p-4 shadow-sm transition-colors hover:border-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600',
        tone === 'attention' ? 'border-orange-300' : 'border-slate-200',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-700">{title}</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900" data-testid={`${testId}-value`}>
            {value}
          </p>
          {hint && <p className="mt-0.5 text-xs text-slate-600">{hint}</p>}
        </div>
        <Icon className={cn('h-6 w-6', tone === 'attention' ? 'text-orange-600' : 'text-indigo-600')} aria-hidden />
      </div>
      <span className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 group-hover:underline">
        {cta} <ArrowRight className="h-4 w-4" aria-hidden />
      </span>
    </Link>
  );
}

const count = (n: number | undefined, pending: boolean): ReactNode => (pending ? <Skeleton className="mt-1 h-7 w-12" /> : (n ?? '—'));

function Section({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <section aria-labelledby={`${testId}-h`} data-testid={testId}>
      <h2 id={`${testId}-h`} className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
    </section>
  );
}

/** Employee tasks — every persona owns claims (BR: a manager is also an employee). */
function EmployeeTasks() {
  const drafts = useClaimCount('DRAFT');
  const sentBack = useClaimCount('SENT_BACK');
  const pm = useClaimCount('PENDING_MANAGER');
  const pa = useClaimCount('PENDING_AUDITOR');
  const pf = useClaimCount('PENDING_FINANCE_HEAD');
  const approved = useClaimCount('APPROVED');
  const inFlightPending = pm.isPending || pa.isPending || pf.isPending;
  const inFlight = (pm.data ?? 0) + (pa.data ?? 0) + (pf.data ?? 0);

  return (
    <Section title="My claims" testId="home-employee">
      <Link
        to="/claims/new"
        data-testid="home-new-claim"
        className="flex flex-col justify-between gap-3 rounded-xl bg-indigo-700 p-4 text-white shadow-sm hover:bg-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2"
      >
        <FilePlus2 className="h-7 w-7" aria-hidden />
        <div>
          <p className="text-lg font-semibold">New claim</p>
          <p className="text-sm text-indigo-100">Capture expenses and receipts, even from your phone</p>
        </div>
      </Link>
      <TaskCard
        icon={RotateCcw}
        title="Sent back to me"
        value={count(sentBack.data, sentBack.isPending)}
        hint="Fix and resubmit"
        to="/claims?status=SENT_BACK"
        cta="Respond"
        tone={(sentBack.data ?? 0) > 0 ? 'attention' : 'default'}
        testId="home-sent-back"
      />
      <TaskCard icon={FileText} title="Drafts" value={count(drafts.data, drafts.isPending)} hint="Not submitted yet" to="/claims?status=DRAFT" cta="Continue" testId="home-drafts" />
      <TaskCard
        icon={ClipboardCheck}
        title="Awaiting approval"
        value={inFlightPending ? <Skeleton className="mt-1 h-7 w-12" /> : inFlight}
        hint={approved.data !== undefined ? `${approved.data} approved, awaiting payout` : undefined}
        to="/claims"
        cta="Track status"
        testId="home-in-flight"
      />
    </Section>
  );
}

function ApproverTasks() {
  const me = useMe();
  const navigate = useNavigate();
  const inbox = useQuery({ queryKey: qk.inbox, queryFn: approvalsApi.inbox, refetchInterval: 60_000 });
  const delegations = useQuery({ queryKey: qk.delegations, queryFn: delegationsApi.list, enabled: hasRole(me, 'MANAGER', 'AUDITOR', 'FINANCE_HEAD') });

  const items = [...(inbox.data ?? [])].sort((a, b) => (itemAge(b) ?? 0) - (itemAge(a) ?? 0));
  const oldest = items[0];
  const myOutgoing = (delegations.data ?? []).filter((d) => d.delegatorId === me.id && isDelegationActive(d));
  const acting = actingFor(me);

  return (
    <Section title="Approvals" testId="home-approver">
      <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:col-span-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-slate-700">Waiting for you</p>
            <p className="mt-1 text-3xl font-bold tabular-nums text-slate-900" data-testid="home-inbox-value">
              {inbox.isPending ? <Skeleton className="mt-1 h-7 w-12" /> : items.length}
            </p>
            {oldest && (
              <p className="mt-1 flex items-center gap-1 text-xs text-slate-600">
                Oldest: {oldest.claimNo} · {oldest.employeeName} · <AgeBadge seconds={itemAge(oldest)} />
              </p>
            )}
          </div>
          <Inbox className="h-6 w-6 text-indigo-600" aria-hidden />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={!oldest}
            onClick={() => oldest && navigate(`/claims/${oldest.claimId}`, { state: { from: '/inbox' } })}
            testId="home-start-review"
          >
            {oldest ? 'Review oldest claim' : 'Inbox zero 🎉'}
          </Button>
          <Link to="/inbox" className="inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50" data-testid="home-open-inbox">
            Open inbox
          </Link>
        </div>
      </div>
      {hasRole(me, 'MANAGER', 'AUDITOR', 'FINANCE_HEAD') && (
        <TaskCard
          icon={Settings2}
          title="Delegation"
          value={myOutgoing.length > 0 ? 'On' : 'Off'}
          hint={
            myOutgoing[0]
              ? `${myOutgoing[0].delegateName ?? 'Delegate'} approves for you until ${formatISTDate(myOutgoing[0].toDate)}`
              : 'Going on leave? Delegate your approvals'
          }
          to="/settings/delegation"
          cta="Manage"
          testId="home-delegation"
        />
      )}
      {acting.length > 0 && (
        <TaskCard
          icon={Inbox}
          title="Acting for"
          value={acting.length}
          hint={acting.map((d) => d.delegatorName ?? `#${d.delegatorId}`).join(', ')}
          to="/inbox"
          cta="Their pending steps"
          testId="home-acting-for"
        />
      )}
    </Section>
  );
}

function AuditorTasks() {
  const me = useMe();
  const total = useQuery({ queryKey: [...qk.auditorQueue, 'home', 'all'], queryFn: () => auditorApi.queue({ page: 0 }), select: (p) => p.totalElements });
  const sample = useQuery({ queryKey: [...qk.auditorQueue, 'home', 'sample'], queryFn: () => auditorApi.queue({ sample: true, page: 0 }), select: (p) => p.totalElements });
  const dups = useQuery({ queryKey: [...qk.auditorQueue, 'home', 'dup'], queryFn: () => auditorApi.queue({ flag: 'DUPLICATE', page: 0 }), select: (p) => p.totalElements });
  const split = useQuery({ queryKey: [...qk.auditorQueue, 'home', 'split'], queryFn: () => auditorApi.queue({ flag: 'SPLIT_SUSPECT', page: 0 }), select: (p) => p.totalElements });

  return (
    <Section title="Audit" testId="home-auditor">
      <TaskCard icon={ClipboardCheck} title="Audit queue" value={count(total.data, total.isPending)} hint="Oldest first" to="/auditor" cta="Work the queue" testId="home-queue" />
      <TaskCard
        icon={ClipboardCheck}
        title="Random sample"
        value={count(sample.data, sample.isPending)}
        hint="10% of auto-approved claims"
        to="/auditor?sample=true"
        cta="Review sample"
        testId="home-sample"
      />
      <TaskCard
        icon={ShieldCheck}
        title="Duplicates flagged"
        value={count(dups.data, dups.isPending)}
        hint="Same receipt, or vendor + amount + date"
        to="/auditor?flag=DUPLICATE"
        cta="Investigate"
        tone={(dups.data ?? 0) > 0 ? 'attention' : 'default'}
        testId="home-duplicates"
      />
      <TaskCard
        icon={ShieldCheck}
        title="Split suspects"
        value={count(split.data, split.isPending)}
        hint="Claims that look split to dodge a threshold"
        to="/auditor?flag=SPLIT_SUSPECT"
        cta="Investigate"
        testId="home-split"
      />
      {!hasRole(me, 'FINANCE_HEAD') && (
        <TaskCard icon={ScrollText} title="Audit trail" value="—" hint="Who did what, and when" to="/audit" cta="Open trail" testId="home-audit" />
      )}
    </Section>
  );
}

function FinanceHeadTasks() {
  const eligible = useQuery({ queryKey: qk.eligible, queryFn: payoutsApi.eligible });
  const batches = useQuery({ queryKey: qk.payouts, queryFn: payoutsApi.list });
  const open = (batches.data ?? []).filter((b) => b.status === 'CREATED' || b.status === 'EXPORTED');
  const eligibleTotal = sumMoney((eligible.data ?? []).map((c) => c.totalAmount));

  return (
    <Section title="Finance" testId="home-finance">
      <TaskCard
        icon={Wallet}
        title="Ready to pay"
        value={count(eligible.data?.length, eligible.isPending)}
        hint={eligible.data ? `Approved claims · ${formatINR(eligibleTotal)}` : undefined}
        to="/payouts"
        cta="Create payout batch"
        testId="home-eligible"
      />
      <TaskCard
        icon={Wallet}
        title="Open batches"
        value={count(open.length, batches.isPending)}
        hint={open.some((b) => b.status === 'EXPORTED') ? 'Exported, waiting to be marked paid' : 'Draft or exported'}
        to="/payouts"
        cta="Finish payouts"
        tone={open.length > 0 ? 'attention' : 'default'}
        testId="home-open-batches"
      />
      <TaskCard icon={ShieldCheck} title="Policy rules" value="Config" hint="Change limits without a deploy" to="/admin/policies" cta="Edit policy" testId="home-policies" />
      <TaskCard icon={BarChart3} title="Dashboard" value="Spend" hint="Category, department, month, violations" to="/dashboard" cta="Open dashboard" testId="home-dashboard" />
    </Section>
  );
}

export default function HomePage() {
  const me = useMe();
  const role = primaryRole(me.roles);
  const firstName = me.name.split(/\s+/)[0] ?? me.name;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900 sm:text-2xl" data-testid="home-greeting">
            Hello, {firstName}
          </h1>
          <p className="text-sm text-slate-600">Your tasks for today</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {me.roles.map((r) => (
            <RoleBadge key={r} role={r} />
          ))}
        </div>
      </div>

      {actingFor(me).length > 0 && (
        <Banner tone="info" testId="home-delegate-banner">
          You are an active delegate for {actingFor(me).map((d) => d.delegatorName ?? `#${d.delegatorId}`).join(', ')}. Their pending steps are in your inbox.
        </Banner>
      )}

      {/* Persona-specific work first, then the employee tasks everyone has. */}
      {isApprover(me) && <ApproverTasks />}
      {hasRole(me, 'AUDITOR', 'FINANCE_HEAD') && <AuditorTasks />}
      {hasRole(me, 'FINANCE_HEAD') && <FinanceHeadTasks />}
      <EmployeeTasks />

      {role === 'EMPLOYEE' && actingFor(me).length === 0 && (
        <p className="text-xs text-slate-600">
          Tip: each line is checked against the company policy as you add it, so you see limits, receipt needs and flags before you submit.
        </p>
      )}
    </div>
  );
}
