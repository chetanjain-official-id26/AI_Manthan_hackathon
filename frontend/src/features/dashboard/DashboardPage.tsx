import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from 'recharts';

type TipProps = TooltipContentProps<TooltipValueType, string | number>;
import { RotateCcw } from 'lucide-react';
import { dashboardApi, type DateRange } from '@/api/dashboard';
import { qk } from '@/api/keys';
import { policiesApi } from '@/api/policies';
import type { Category } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { PageHeader, Skeleton, Stat } from '@/components/ui/Display';
import { Link } from 'react-router';
import { Field, Input } from '@/components/ui/Field';
import { useMe } from '@/features/auth/AuthContext';
import { hasRole } from '@/features/auth/permissions';
import { CATEGORY_LABEL, ruleLabel } from '@/utils/labels';
import { formatINR, formatINRCompact, toNumber } from '@/utils/money';
import { formatAge, formatHours, formatIST, formatMonth, todayIST } from '@/utils/time';
import { Card, Money } from '@/components/ui/Display';
import { ChartCard } from './ChartCard';

// Single-series charts: one hue, no legend; text stays in text inks.
const MARK = '#4f46e5'; // indigo-600
const GRID = '#e2e8f0'; // slate-200
const AXIS = '#475569'; // slate-600
const tick = { fill: AXIS, fontSize: 12 };

function MoneyTooltip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  const v = payload[0]?.value;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-slate-900">{String(label)}</p>
      <p className="tabular-nums text-slate-700">{typeof v === 'number' ? formatINR(v.toFixed(2)) : '—'}</p>
    </div>
  );
}

function CountTooltip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-slate-900">{String(label)}</p>
      <p className="tabular-nums text-slate-700">{payload[0]?.value} violations</p>
    </div>
  );
}

const catLabel = (c: string) => CATEGORY_LABEL[c as Category] ?? c;

export default function DashboardPage() {
  const me = useMe();
  const scopeTeam = !hasRole(me, 'AUDITOR', 'FINANCE_HEAD');
  const [range, setRange] = useState<DateRange>({});
  const today = todayIST();

  const key = [...qk.dashboard, range.from ?? '', range.to ?? ''];
  const byCategory = useQuery({ queryKey: [...key, 'category'], queryFn: () => dashboardApi.spendByCategory(range) });
  const byDept = useQuery({ queryKey: [...key, 'department'], queryFn: () => dashboardApi.spendByDepartment(range) });
  const byMonth = useQuery({ queryKey: [...key, 'month'], queryFn: () => dashboardApi.spendByMonth(range) });
  const violations = useQuery({ queryKey: [...key, 'violations'], queryFn: () => dashboardApi.violations(range) });
  const approvalTime = useQuery({ queryKey: [...key, 'approval-time'], queryFn: () => dashboardApi.approvalTime(range) });
  const ruleChanges = useQuery({
    queryKey: [...qk.policies, 'recent'],
    queryFn: () => policiesApi.list(true),
    enabled: !scopeTeam,
    select: (rules) => rules.filter((r) => r.version > 1).sort((a, b) => (b.createdAt ?? b.effectiveFrom).localeCompare(a.createdAt ?? a.effectiveFrom)).slice(0, 5),
  });
  const kpis = useQuery({ queryKey: [...key, 'kpis'], queryFn: () => dashboardApi.kpis(range) });

  const avgHours =
    approvalTime.data && approvalTime.data.length > 0
      ? approvalTime.data.reduce((s, r) => s + r.avgHours, 0) / approvalTime.data.length
      : null;
  const duplicates = violations.data
    ? violations.data.filter((v) => v.ruleCode.startsWith('DUPLICATE')).reduce((s, v) => s + v.count, 0)
    : null;

  const catRows = (byCategory.data ?? []).map((r) => ({ name: catLabel(String(r.category)), value: toNumber(r.total), raw: r.total }));
  const deptRows = [...(byDept.data ?? [])]
    .map((r) => ({ name: r.department, value: toNumber(r.total), raw: r.total }))
    .sort((a, b) => b.value - a.value);
  const monthRows = [...(byMonth.data ?? [])]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((r) => ({ name: formatMonth(r.month), value: toNumber(r.total), raw: r.total }));
  const violRows = [...(violations.data ?? [])]
    .map((r) => ({ name: ruleLabel(r.ruleCode), value: r.count }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-5">
      <PageHeader title="Dashboard" subtitle={scopeTeam ? 'Spend and approvals for your team' : 'Spend, policy violations and approval speed'} />

      <section className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm" aria-label="Date range" data-testid="dashboard-filters">
        <Field label="From" className="w-40">
          {(p) => (
            <Input {...p} type="date" max={range.to ?? today} value={range.from ?? ''} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value || undefined }))} data-testid="dash-from" />
          )}
        </Field>
        <Field label="To" className="w-40">
          {(p) => (
            <Input
              {...p}
              type="date"
              min={range.from}
              max={today}
              value={range.to ?? ''}
              onChange={(e) => setRange((r) => ({ ...r, to: e.target.value || undefined }))}
              data-testid="dash-to"
            />
          )}
        </Field>
        <Button variant="ghost" icon={<RotateCcw className="h-4 w-4" aria-hidden />} onClick={() => setRange({})} disabled={!range.from && !range.to} testId="dash-reset">
          All time
        </Button>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="kpi-tiles">
        <Stat label="Avg approval time" value={approvalTime.isPending ? <Skeleton className="h-7 w-20" /> : formatHours(avgHours)} hint="Mean across departments" testId="kpi-avg-approval" />
        <Stat
          label="Pending claims"
          value={kpis.isPending ? <Skeleton className="h-7 w-16" /> : (kpis.data?.pendingClaims ?? '—')}
          hint={kpis.data === null ? 'Needs /dashboard/kpis' : 'Waiting at any step'}
          testId="kpi-pending"
        />
        <Stat
          label="Oldest pending"
          value={kpis.isPending ? <Skeleton className="h-7 w-16" /> : formatAge(kpis.data?.oldestPendingSeconds)}
          hint={kpis.data === null ? 'Needs /dashboard/kpis' : 'Alert at 48 h'}
          testId="kpi-oldest"
        />
        <Stat label="Duplicates caught" value={violations.isPending ? <Skeleton className="h-7 w-12" /> : (duplicates ?? '—')} hint="Vendor/amount/date + receipt hash" testId="kpi-duplicates" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Spend by category"
          rows={catRows}
          loading={byCategory.isPending}
          error={byCategory.error}
          onRetry={() => void byCategory.refetch()}
          testId="chart-category"
          columns={[
            { header: 'Category', cell: (r) => r.name },
            { header: 'Total', cell: (r) => formatINR(r.raw), align: 'right' },
          ]}
          chart={(rows) => (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap="30%">
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="name" tick={tick} tickLine={false} axisLine={{ stroke: GRID }} />
                <YAxis tickFormatter={formatINRCompact} tick={tick} tickLine={false} axisLine={false} width={64} />
                <Tooltip content={MoneyTooltip} cursor={{ fill: '#eef2ff' }} />
                <Bar dataKey="value" name="Spend" fill={MARK} radius={[4, 4, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ResponsiveContainer>
          )}
        />

        <ChartCard
          title="Spend by department"
          rows={deptRows}
          loading={byDept.isPending}
          error={byDept.error}
          onRetry={() => void byDept.refetch()}
          testId="chart-department"
          columns={[
            { header: 'Department', cell: (r) => r.name },
            { header: 'Total', cell: (r) => formatINR(r.raw), align: 'right' },
          ]}
          chart={(rows) => (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }} barCategoryGap="25%">
                <CartesianGrid horizontal={false} stroke={GRID} />
                <XAxis type="number" tickFormatter={formatINRCompact} tick={tick} tickLine={false} axisLine={{ stroke: GRID }} />
                <YAxis type="category" dataKey="name" tick={tick} tickLine={false} axisLine={false} width={96} />
                <Tooltip content={MoneyTooltip} cursor={{ fill: '#eef2ff' }} />
                <Bar dataKey="value" name="Spend" fill={MARK} radius={[0, 4, 4, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          )}
        />

        <ChartCard
          title="Spend by month"
          description="Last 12 months"
          rows={monthRows}
          loading={byMonth.isPending}
          error={byMonth.error}
          onRetry={() => void byMonth.refetch()}
          testId="chart-month"
          columns={[
            { header: 'Month', cell: (r) => r.name },
            { header: 'Total', cell: (r) => formatINR(r.raw), align: 'right' },
          ]}
          chart={(rows) => (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="name" tick={tick} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={16} />
                <YAxis tickFormatter={formatINRCompact} tick={tick} tickLine={false} axisLine={false} width={64} />
                <Tooltip content={MoneyTooltip} cursor={{ stroke: AXIS, strokeDasharray: '3 3' }} />
                <Line type="monotone" dataKey="value" name="Spend" stroke={MARK} strokeWidth={2} animationDuration={500} dot={{ r: 3, fill: MARK }} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        />

        <ChartCard
          title="Policy violations by rule"
          rows={violRows}
          loading={violations.isPending}
          error={violations.error}
          onRetry={() => void violations.refetch()}
          testId="chart-violations"
          columns={[
            { header: 'Rule', cell: (r) => r.name },
            { header: 'Count', cell: (r) => r.value.toLocaleString('en-IN'), align: 'right' },
          ]}
          chart={(rows) => (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }} barCategoryGap="25%">
                <CartesianGrid horizontal={false} stroke={GRID} />
                <XAxis type="number" allowDecimals={false} tick={tick} tickLine={false} axisLine={{ stroke: GRID }} />
                <YAxis type="category" dataKey="name" tick={{ ...tick, fontSize: 11 }} tickLine={false} axisLine={false} width={150} />
                <Tooltip content={CountTooltip} cursor={{ fill: '#eef2ff' }} />
                <Bar dataKey="value" name="Violations" fill={MARK} radius={[0, 4, 4, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          )}
        />
      </div>

      <ChartCard
        title="Average approval time by department"
        rows={approvalTime.data}
        loading={approvalTime.isPending}
        error={approvalTime.error}
        onRetry={() => void approvalTime.refetch()}
        testId="chart-approval-time"
        columns={[
          { header: 'Department', cell: (r) => r.department },
          { header: 'Avg time', cell: (r) => formatHours(r.avgHours), align: 'right' },
          { header: 'Hours', cell: (r) => r.avgHours.toFixed(1), align: 'right' },
        ]}
        chart={(rows) => (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="department" tick={tick} tickLine={false} axisLine={{ stroke: GRID }} interval={0} angle={rows.length > 6 ? -30 : 0} textAnchor={rows.length > 6 ? 'end' : 'middle'} height={rows.length > 6 ? 56 : 30} />
              <YAxis tick={tick} tickLine={false} axisLine={false} width={40} unit="h" />
              <Tooltip
                cursor={{ fill: '#eef2ff' }}
                formatter={(v) => [formatHours(Number(v)), 'Avg approval time']}
                contentStyle={{ borderRadius: 6, borderColor: GRID, fontSize: 12 }}
              />
              <Bar dataKey="avgHours" name="Avg hours" fill={MARK} radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        )}
      />

      {!scopeTeam && (
        <Card
          title="Recent policy rule changes"
          actions={
            <Link to="/admin/policies" className="text-sm font-medium text-indigo-700 hover:underline" data-testid="dash-open-policies">
              Open rules
            </Link>
          }
        >
          {ruleChanges.isPending ? (
            <div className="space-y-2" aria-hidden>
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : ruleChanges.isError ? (
            <p className="text-sm text-red-700">Could not load rule history.</p>
          ) : (ruleChanges.data ?? []).length === 0 ? (
            <p className="text-sm text-slate-600">No rule has been changed since the seed.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm" data-testid="dash-rule-changes">
              {(ruleChanges.data ?? []).map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>
                    <strong>{ruleLabel(r.ruleCode)}</strong> v{r.version}
                    {r.limitAmount != null && (
                      <>
                        {' '}
                        · limit <Money value={r.limitAmount} />
                      </>
                    )}
                    {r.reason && <span className="text-slate-600"> · “{r.reason}”</span>}
                  </span>
                  <span className="text-xs text-slate-600">
                    {r.createdByName ?? '—'} · {formatIST(r.createdAt ?? r.effectiveFrom)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
