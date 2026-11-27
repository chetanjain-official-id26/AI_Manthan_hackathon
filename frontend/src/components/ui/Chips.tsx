import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Ban,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  Circle,
  Clock3,
  Copy,
  Dice5,
  FilePen,
  Flag as FlagIcon,
  Hourglass,
  Receipt,
  Scissors,
  Send,
  ShieldX,
  Undo2,
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { ClaimStatus, Flag, PayoutStatus, PolicyOutcome, Role } from '@/api/types';
import { FLAG_DESCRIPTION, FLAG_LABEL, OUTCOME_LABEL, PAYOUT_STATUS_LABEL, ROLE_LABEL, STATUS_LABEL } from '@/utils/labels';
import { cn } from '@/utils/misc';

/** Pill badge: tinted background, matching border, icon + text (never colour alone). Text ≥ 4.5:1. */
const base = 'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap leading-5';

const STATUS: Record<ClaimStatus, { tone: string; Icon: LucideIcon }> = {
  DRAFT: { tone: 'bg-slate-50 text-slate-700 border-slate-200', Icon: FilePen },
  SUBMITTED: { tone: 'bg-slate-50 text-slate-700 border-slate-200', Icon: Send },
  PENDING_MANAGER: { tone: 'bg-amber-50 text-amber-800 border-amber-200', Icon: Clock3 },
  PENDING_AUDITOR: { tone: 'bg-amber-50 text-amber-800 border-amber-200', Icon: Clock3 },
  PENDING_FINANCE_HEAD: { tone: 'bg-amber-50 text-amber-800 border-amber-200', Icon: Clock3 },
  SENT_BACK: { tone: 'bg-orange-50 text-orange-800 border-orange-200', Icon: Undo2 },
  APPROVED: { tone: 'bg-green-50 text-green-800 border-green-200', Icon: CheckCircle2 },
  IN_PAYOUT: { tone: 'bg-blue-50 text-blue-800 border-blue-200', Icon: Wallet },
  PAID: { tone: 'bg-emerald-100 text-emerald-900 border-emerald-300', Icon: BadgeCheck },
  REJECTED: { tone: 'bg-red-50 text-red-800 border-red-200', Icon: XCircle },
  POLICY_REJECTED: { tone: 'bg-red-50 text-red-800 border-red-200', Icon: ShieldX },
};

export function StatusChip({ status, className }: { status: ClaimStatus; className?: string }) {
  const s = STATUS[status] ?? STATUS.DRAFT;
  return (
    <span className={cn(base, s.tone, className)} data-testid={`status-chip-${status}`}>
      <s.Icon className="h-3 w-3" aria-hidden />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

const FLAG_ICON: Record<Flag, LucideIcon> = {
  OVER_LIMIT: AlertTriangle,
  DUPLICATE: Copy,
  WEEKEND: CalendarClock,
  RECEIPT: Receipt,
  SAMPLE: Dice5,
  SPLIT_SUSPECT: Scissors,
  STALE: Hourglass,
};

const FLAG_TONE: Record<Flag, string> = {
  OVER_LIMIT: 'bg-amber-50 text-amber-800 border-amber-200',
  DUPLICATE: 'bg-fuchsia-50 text-fuchsia-800 border-fuchsia-200',
  WEEKEND: 'bg-sky-50 text-sky-800 border-sky-200',
  RECEIPT: 'bg-red-50 text-red-800 border-red-200',
  SAMPLE: 'bg-violet-50 text-violet-800 border-violet-200',
  SPLIT_SUSPECT: 'bg-orange-50 text-orange-800 border-orange-200',
  STALE: 'bg-stone-100 text-stone-800 border-stone-300',
};

export function FlagChip({ flag, detail, className }: { flag: Flag; detail?: string; className?: string }) {
  const Icon = FLAG_ICON[flag] ?? FlagIcon;
  const title = detail ?? FLAG_DESCRIPTION[flag];
  return (
    <span className={cn(base, FLAG_TONE[flag] ?? FLAG_TONE.OVER_LIMIT, className)} title={title} data-testid={`flag-chip-${flag}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {FLAG_LABEL[flag] ?? flag}
      <span className="sr-only">: {title}</span>
    </span>
  );
}

export function FlagList({ flags, sample }: { flags?: Flag[] | null; sample?: boolean }) {
  const set = new Set<Flag>(flags ?? []);
  if (sample) set.add('SAMPLE');
  if (set.size === 0) return <span className="text-xs text-slate-400">—<span className="sr-only">No flags</span></span>;
  return (
    <span className="flex flex-wrap gap-1">
      {[...set].map((f) => (
        <FlagChip key={f} flag={f} />
      ))}
    </span>
  );
}

export function OutcomeBadge({ outcome, compact = false }: { outcome: PolicyOutcome | null | undefined; compact?: boolean }) {
  if (!outcome) return <span className="text-xs text-slate-500">Not checked</span>;
  const map: Record<PolicyOutcome, { Icon: LucideIcon; tone: string }> = {
    AUTO_APPROVE: { Icon: CheckCircle2, tone: 'text-green-800 bg-green-50 border-green-200' },
    ROUTE: { Icon: FlagIcon, tone: 'text-amber-800 bg-amber-50 border-amber-200' },
    AUTO_REJECT: { Icon: XCircle, tone: 'text-red-800 bg-red-50 border-red-200' },
  };
  const m = map[outcome];
  return (
    <span className={cn(base, m.tone)} data-testid={`outcome-${outcome}`} title={OUTCOME_LABEL[outcome]}>
      <m.Icon className="h-3.5 w-3.5" aria-hidden />
      {compact ? <span className="sr-only">{OUTCOME_LABEL[outcome]}</span> : OUTCOME_LABEL[outcome]}
    </span>
  );
}

const PAYOUT: Record<PayoutStatus, { tone: string; Icon: LucideIcon }> = {
  CREATED: { tone: 'bg-slate-50 text-slate-700 border-slate-200', Icon: Circle },
  EXPORTED: { tone: 'bg-blue-50 text-blue-800 border-blue-200', Icon: Send },
  PAID: { tone: 'bg-emerald-100 text-emerald-900 border-emerald-300', Icon: BadgeCheck },
  VOIDED: { tone: 'bg-red-50 text-red-800 border-red-200', Icon: Ban },
};

export function PayoutStatusChip({ status }: { status: PayoutStatus }) {
  const p = PAYOUT[status] ?? PAYOUT.CREATED;
  return (
    <span className={cn(base, p.tone)} data-testid={`payout-status-${status}`}>
      <p.Icon className="h-3 w-3" aria-hidden />
      {PAYOUT_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function RoleBadge({ role, dark = false }: { role: Role; dark?: boolean }) {
  return (
    <span
      className={cn(base, dark ? 'border-white/15 bg-white/10 text-slate-100' : 'border-indigo-200 bg-indigo-50 text-indigo-800')}
      data-testid={`role-badge-${role}`}
    >
      {ROLE_LABEL[role]}
    </span>
  );
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'violet' | 'indigo' }) {
  const t = {
    slate: 'bg-slate-50 text-slate-700 border-slate-200',
    violet: 'bg-violet-50 text-violet-800 border-violet-200',
    indigo: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  }[tone];
  return <span className={cn(base, t)}>{children}</span>;
}
