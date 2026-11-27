import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Inbox, RefreshCw } from 'lucide-react';
import type { Money as MoneyValue } from '@/api/types';
import { ApiError, errorMessage } from '@/api/client';
import { formatINR } from '@/utils/money';
import { ageTone, formatAge } from '@/utils/time';
import { cn } from '@/utils/misc';
import { Button } from './Button';

export function Money({ value, className, strong }: { value: MoneyValue | null | undefined; className?: string; strong?: boolean }) {
  return <span className={cn('tabular-nums whitespace-nowrap', strong && 'font-semibold text-slate-900', className)}>{formatINR(value)}</span>;
}

export function AgeBadge({ seconds, testId }: { seconds: number | null | undefined; testId?: string }) {
  const tone = ageTone(seconds);
  const cls = {
    normal: 'bg-slate-50 text-slate-700 border-slate-200',
    warn: 'bg-amber-50 text-amber-800 border-amber-300',
    danger: 'bg-red-50 text-red-700 border-red-300',
  }[tone];
  const dot = { normal: 'bg-slate-400', warn: 'bg-amber-500', danger: 'bg-red-500' }[tone];
  const label = tone === 'danger' ? 'over 48 hours' : tone === 'warn' ? 'over 24 hours' : 'within SLA';
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums whitespace-nowrap', cls)}
      title={`Waiting ${label}`}
      data-testid={testId ?? 'age-badge'}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} aria-hidden />
      {formatAge(seconds)}
      <span className="sr-only"> ({label})</span>
    </span>
  );
}

// ---------------------------------------------------------------- skeletons
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('ef-skeleton rounded-md', className)} aria-hidden />;
}

/** Table-shaped shimmer: header strip plus rows with column blocks. */
export function SkeletonRows({ rows = 6, cols = 6, testId = 'loading-skeleton' }: { rows?: number; cols?: number; testId?: string }) {
  const widths = ['w-16', 'w-28', 'w-40', 'w-24', 'w-20', 'w-16', 'w-24', 'w-14'];
  return (
    <div className="ef-table-wrap" role="status" aria-label="Loading" data-testid={testId}>
      <div className="flex gap-6 border-b border-slate-200 bg-slate-50 px-4 py-3">
        {Array.from({ length: cols }, (_, c) => (
          <Skeleton key={c} className={cn('h-2.5', widths[c % widths.length])} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-6 border-b border-slate-100 px-4 py-3.5 last:border-0">
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton key={c} className={cn('h-3', widths[(c + r) % widths.length])} />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function SkeletonCards({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-4', className)} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-7 w-20" />
          <Skeleton className="mt-3 h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/** Split-pane shimmer matching the claim detail / editor layout. */
export function SkeletonDetail({ testId = 'loading-skeleton' }: { testId?: string }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2" role="status" aria-label="Loading" data-testid={testId}>
      <Skeleton className="h-64 rounded-xl lg:h-[calc(100dvh-9rem)]" />
      <div className="space-y-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <div className="space-y-2 rounded-xl border border-slate-200/80 bg-white p-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function SkeletonChart() {
  return (
    <div className="flex h-[260px] items-end gap-3 border-b border-slate-200 px-2" aria-hidden>
      {[55, 80, 40, 92, 65, 30, 72].map((h, i) => (
        <div key={i} className="flex-1" style={{ height: `${h}%` }}>
          <Skeleton className="h-full w-full rounded-b-none" />
        </div>
      ))}
    </div>
  );
}

/** Whole-page placeholder (lazy routes, session bootstrap). */
export function PageSkeleton({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="space-y-5" role="status" aria-label={label}>
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <SkeletonCards />
      <SkeletonRows rows={5} testId="page-skeleton" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------- states
export function EmptyState({
  title,
  description,
  action,
  icon,
  testId = 'empty-state',
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center" data-testid={testId}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500 [&_svg]:h-6 [&_svg]:w-6">
        {icon ?? <Inbox aria-hidden />}
      </div>
      <h2 className="text-base font-semibold tracking-tight text-slate-900">{title}</h2>
      {description && <p className="max-w-md text-sm text-slate-500">{description}</p>}
      {action}
    </div>
  );
}

type BannerTone = 'info' | 'warning' | 'error' | 'success' | 'orange';

export function Banner({
  tone = 'info',
  title,
  children,
  action,
  testId,
}: {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  testId?: string;
}) {
  const t: Record<BannerTone, string> = {
    info: 'bg-blue-50/70 border-blue-200 text-blue-900 [&_.ef-ico]:text-blue-600',
    warning: 'bg-amber-50/80 border-amber-300 text-amber-900 [&_.ef-ico]:text-amber-600',
    error: 'bg-red-50/80 border-red-300 text-red-900 [&_.ef-ico]:text-red-600',
    success: 'bg-emerald-50/80 border-emerald-300 text-emerald-900 [&_.ef-ico]:text-emerald-600',
    orange: 'bg-orange-50/80 border-orange-300 text-orange-900 [&_.ef-ico]:text-orange-600',
  };
  const Icon = tone === 'error' ? AlertCircle : tone === 'warning' || tone === 'orange' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info;
  return (
    <div
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('flex flex-col gap-2 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-start', t[tone])}
      data-testid={testId}
    >
      <Icon className="ef-ico mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title ? 'mt-0.5 opacity-90' : '')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function ErrorBanner({ error, onRetry, testId = 'error-banner' }: { error: unknown; onRetry?: () => void; testId?: string }) {
  if (error instanceof ApiError && error.isConflict) {
    return <ConflictBanner onRefresh={onRetry} />;
  }
  return (
    <Banner
      tone="error"
      title="Something went wrong"
      testId={testId}
      action={
        onRetry && (
          <Button size="sm" onClick={onRetry} icon={<RefreshCw className="h-4 w-4" aria-hidden />} testId={`${testId}-retry`}>
            Retry
          </Button>
        )
      }
    >
      {errorMessage(error)}
    </Banner>
  );
}

export function ConflictBanner({ onRefresh }: { onRefresh?: () => void }) {
  return (
    <Banner
      tone="warning"
      title="Update conflict"
      testId="conflict-banner"
      action={
        onRefresh && (
          <Button size="sm" onClick={onRefresh} icon={<RefreshCw className="h-4 w-4" aria-hidden />} testId="conflict-refresh">
            Refresh
          </Button>
        )
      }
    >
      This claim was updated by someone else. Refresh to see the latest state.
    </Banner>
  );
}

// ---------------------------------------------------------------- layout pieces
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cn('rounded-xl border border-slate-200/80 bg-white shadow-xs', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {title && <h2 className="text-sm font-semibold tracking-tight text-slate-900">{title}</h2>}
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Pagination({
  page,
  totalPages,
  totalElements,
  onPage,
  testId = 'pagination',
}: {
  page: number;
  totalPages: number;
  totalElements?: number;
  onPage: (p: number) => void;
  testId?: string;
}) {
  if (totalPages <= 1 && !totalElements) return null;
  return (
    <nav className="flex items-center justify-between gap-2 pt-3 text-sm text-slate-600" aria-label="Pagination" data-testid={testId}>
      <span className="tabular-nums">
        Page {page + 1} of {Math.max(totalPages, 1)}
        {typeof totalElements === 'number' && <span className="text-slate-400"> · {totalElements.toLocaleString('en-IN')} total</span>}
      </span>
      <div className="flex gap-2">
        <Button size="sm" disabled={page <= 0} onClick={() => onPage(page - 1)} testId={`${testId}-prev`}>
          Previous
        </Button>
        <Button size="sm" disabled={page + 1 >= totalPages} onClick={() => onPage(page + 1)} testId={`${testId}-next`}>
          Next
        </Button>
      </div>
    </nav>
  );
}

export function Stat({ label, value, hint, testId, icon }: { label: string; value: ReactNode; hint?: ReactNode; testId?: string; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        {icon && <span className="text-slate-400 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
      </div>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
