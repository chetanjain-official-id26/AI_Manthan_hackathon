import { lazy, Suspense, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BadgeCheck,
  Copy,
  FlaskConical,
  Landmark,
  Loader2,
  LogIn,
  Search,
  ServerCrash,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { authApi } from '@/api/auth';
import { ApiError, errorMessage, tokenStore } from '@/api/client';
import { qk } from '@/api/keys';
import { disableMockMode, enableMockMode, isMockMode } from '@/api/mock/mode';
import { ROLES, type DemoUser, type Role } from '@/api/types';
import { Button } from '@/components/ui/Button';
import { Banner, EmptyState, Skeleton } from '@/components/ui/Display';
import { Input } from '@/components/ui/Field';
import { ROLE_LABEL, initials } from '@/utils/labels';
import { cn } from '@/utils/misc';
import { useAuth } from './AuthContext';
import { homePath, primaryRole } from './permissions';
import { canRunLoginScene } from './sceneSupport';

// three.js is code-split: downloaded only when the desktop showcase can actually animate.
const LoginScene = lazy(() => import('./LoginScene'));

const VISIBLE = 8;

const ROLE_HINT: Record<Role, string> = {
  EMPLOYEE: 'Capture claims and receipts, track status',
  MANAGER: 'Approve your team’s claims, oldest first',
  AUDITOR: 'Work the risk queue and the 10% sample',
  FINANCE_HEAD: 'Final approvals, payouts and policy',
};

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: ShieldCheck, title: 'Real-time policy engine', body: 'Every line checked against versioned rules as it is typed.' },
  { icon: Workflow, title: 'Multi-level approvals', body: 'Manager → auditor → finance head, with delegation and SLA timers.' },
  { icon: Copy, title: 'Duplicate detection', body: 'Receipt hashes and vendor/amount/date matches across employees.' },
  { icon: Landmark, title: 'Bank payout export', body: 'Batch approved claims into a control-totalled bank CSV.' },
];

const AVATAR_TONES = ['bg-indigo-100 text-indigo-800', 'bg-emerald-100 text-emerald-800', 'bg-amber-100 text-amber-800', 'bg-sky-100 text-sky-800', 'bg-rose-100 text-rose-800', 'bg-violet-100 text-violet-800'];

type ApiState = 'checking' | 'connected' | 'offline' | 'demo';

function StatusPill({ state }: { state: ApiState }) {
  const cfg = {
    checking: { dot: 'bg-slate-400 animate-pulse', text: 'Checking API…', cls: 'border-white/10 bg-white/5 text-slate-300' },
    connected: { dot: 'bg-emerald-400', text: 'API connected', cls: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200' },
    offline: { dot: 'bg-red-400', text: 'API unreachable', cls: 'border-red-400/20 bg-red-400/10 text-red-200' },
    demo: { dot: 'bg-amber-400', text: 'Demo mode · mock data', cls: 'border-amber-400/20 bg-amber-400/10 text-amber-200' },
  }[state];
  return (
    <span className={cn('inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium', cfg.cls)} data-testid="api-status">
      <span className={cn('h-1.5 w-1.5 rounded-full', cfg.dot)} aria-hidden />
      {cfg.text}
    </span>
  );
}

function Showcase({ status }: { status: ReactNode }) {
  const [animate] = useState(canRunLoginScene);
  return (
    <aside className="relative hidden overflow-hidden bg-slate-950 text-white lg:flex lg:w-[45%] lg:flex-col lg:justify-between lg:p-12 xl:p-16" aria-label="About ExpenseFlow">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 10% 10%, rgba(99,102,241,0.35), transparent 60%), radial-gradient(50% 40% at 90% 30%, rgba(14,165,233,0.18), transparent 60%), radial-gradient(60% 50% at 50% 100%, rgba(139,92,246,0.25), transparent 60%)',
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)', backgroundSize: '40px 40px' }}
        aria-hidden
      />
      {animate && (
        <Suspense fallback={null}>
          <LoginScene />
        </Suspense>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-950/80 via-slate-950/40 to-transparent" aria-hidden />
      <div className="relative flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="h-9 w-9" />
          <span className="text-lg font-semibold tracking-tight">ExpenseFlow</span>
        </div>
        {status}
      </div>

      <div className="relative max-w-lg">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-indigo-200">
          <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Audit-ready by design
        </p>
        <h2 className="text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
          Policy-checked, audit-proof expense claims <span className="text-indigo-300">in minutes.</span>
        </h2>
        <p className="mt-4 text-base text-slate-300">From phone receipt to bank file, with every decision explained and every step on an append-only trail.</p>
        <ul className="mt-10 grid gap-5 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <li key={f.title} className="flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-indigo-300">
                <f.icon className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-medium text-white">{f.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{f.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-xs text-slate-500">All data is synthetic · AI Manthan, Track A</p>
    </aside>
  );
}

export default function LoginPage() {
  const { token, me, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const from = (location.state as { from?: string } | null)?.from;

  const [tab, setTab] = useState<Role>('EMPLOYEE');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [signingIn, setSigningIn] = useState<number | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [logoutReason] = useState(() => tokenStore.logoutReason());
  const [mock, setMock] = useState(() => isMockMode());
  const tabRefs = useRef<Record<Role, HTMLButtonElement | null>>({ EMPLOYEE: null, MANAGER: null, AUDITOR: null, FINANCE_HEAD: null });

  const usersQuery = useQuery({ queryKey: [...qk.demoUsers, mock ? 'mock' : 'live'], queryFn: authApi.demoUsers, retry: 1 });

  const byTab = useMemo(() => {
    const groups: Record<Role, DemoUser[]> = { EMPLOYEE: [], MANAGER: [], AUDITOR: [], FINANCE_HEAD: [] };
    for (const u of usersQuery.data ?? []) groups[primaryRole(u.roles)].push(u);
    for (const r of ROLES) groups[r].sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }, [usersQuery.data]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = byTab[tab];
    if (!q) return list.slice(0, VISIBLE);
    return list.filter((u) => [u.name, u.department, u.departmentName, u.empCode].some((f) => f?.toLowerCase().includes(q))).slice(0, 50);
  }, [byTab, tab, search]);

  if (token && me) return <Navigate to={from ?? homePath(me)} replace />;

  const selectedUser = visible.find((u) => u.id === selected) ?? byTab[tab].find((u) => u.id === selected);
  const apiState: ApiState = mock ? 'demo' : usersQuery.isPending ? 'checking' : usersQuery.isError ? 'offline' : 'connected';

  async function signIn(id: number | null) {
    if (id === null || signingIn !== null) return;
    setSigningIn(id);
    setLoginError(null);
    try {
      const user = await login(id);
      navigate(from ?? homePath(user), { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) setLoginError('Too many sign-in attempts. Wait a minute and try again.');
      else setLoginError(errorMessage(e));
    } finally {
      setSigningIn(null);
    }
  }

  function switchMock(on: boolean) {
    if (on) enableMockMode();
    else disableMockMode();
    setMock(on);
    setSelected(null);
    setLoginError(null);
    qc.removeQueries({ queryKey: qk.demoUsers });
  }

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    const i = ROLES.indexOf(tab);
    let next = i;
    if (e.key === 'ArrowRight') next = (i + 1) % ROLES.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + ROLES.length) % ROLES.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ROLES.length - 1;
    else return;
    e.preventDefault();
    const role = ROLES[next] ?? 'EMPLOYEE';
    setTab(role);
    setSelected(null);
    tabRefs.current[role]?.focus();
  }

  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    const idx = visible.findIndex((u) => u.id === selected);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = e.key === 'ArrowDown' ? Math.min(idx + 1, visible.length - 1) : Math.max(idx - 1, 0);
      const u = visible[n];
      if (u) {
        setSelected(u.id);
        document.getElementById(`login-user-${u.id}`)?.focus();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void signIn(selected);
    }
  }

  const launchMock = (
    <Button variant="secondary" icon={<FlaskConical className="h-4 w-4" aria-hidden />} onClick={() => switchMock(true)} testId="login-launch-mock">
      Launch with Demo Mock Data
    </Button>
  );

  return (
    <main className="flex min-h-dvh w-full bg-white">
      <Showcase status={<StatusPill state={apiState} />} />

      <section className="flex min-h-dvh w-full flex-col bg-slate-50 lg:w-[55%] lg:bg-white">
        {/* mobile brand bar */}
        <div className="flex items-center justify-between gap-3 bg-slate-950 px-4 py-4 text-white sm:px-6 lg:hidden">
          <div className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="h-8 w-8" />
            <span className="font-semibold tracking-tight">ExpenseFlow</span>
          </div>
          <StatusPill state={apiState} />
        </div>

        <div className="flex flex-1 items-start justify-center px-4 py-6 sm:px-8 sm:py-8 lg:items-center lg:py-12">
          <div className="w-full max-w-xl sm:rounded-2xl sm:border sm:border-slate-200/80 sm:bg-white sm:p-8 sm:shadow-xs lg:border-0 lg:p-0 lg:shadow-none" data-testid="login-card">
            <div className="mb-7">
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Sign in to ExpenseFlow</h1>
              <p className="mt-1.5 text-sm text-slate-500">Demo sign-in: pick a seeded persona. A JWT is still issued and checked on every API call.</p>
            </div>

            {logoutReason && (
              <div className="mb-5">
                <Banner tone="warning" testId="session-expired">
                  {logoutReason === 'expired' ? 'Your session expired. Sign in again to continue.' : 'Your session is no longer valid. Sign in again.'}
                </Banner>
              </div>
            )}
            {mock && (
              <div className="mb-5">
                <Banner
                  tone="warning"
                  title="Demo mode"
                  testId="login-demo-banner"
                  action={
                    <Button size="sm" variant="ghost" onClick={() => switchMock(false)} testId="login-exit-mock">
                      Use live API
                    </Button>
                  }
                >
                  Everything runs on in-memory sample data in this tab. Nothing reaches the backend.
                </Banner>
              </div>
            )}

            <div role="tablist" aria-label="Role" className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1" data-testid="login-tabs">
              {ROLES.map((r) => (
                <button
                  key={r}
                  ref={(el) => {
                    tabRefs.current[r] = el;
                  }}
                  role="tab"
                  type="button"
                  id={`login-tab-${r}`}
                  aria-selected={tab === r}
                  aria-controls="login-panel"
                  tabIndex={tab === r ? 0 : -1}
                  onKeyDown={onTabKey}
                  onClick={() => {
                    setTab(r);
                    setSelected(null);
                  }}
                  data-testid={`login-tab-${r}`}
                  className={cn(
                    'flex flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-xs font-medium transition-all duration-150 sm:px-3 sm:text-sm',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600',
                    tab === r ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800',
                  )}
                >
                  {ROLE_LABEL[r]}
                  <span className={cn('hidden rounded-full px-1.5 text-[11px] tabular-nums', usersQuery.isSuccess && 'sm:inline', tab === r ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200/70 text-slate-500')}>
                    ({byTab[r].length})
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">{ROLE_HINT[tab]}</p>

            <div id="login-panel" role="tabpanel" aria-labelledby={`login-tab-${tab}`} className="mt-4">
              <label htmlFor="login-search" className="sr-only">
                Search users
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <Input
                  id="login-search"
                  type="search"
                  placeholder={`Search ${ROLE_LABEL[tab].toLowerCase()}s by name or department`}
                  className="pl-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  data-testid="login-search"
                />
              </div>

              <div className="mt-3 min-h-[300px]">
                {usersQuery.isPending ? (
                  <div className="grid gap-2 sm:grid-cols-2" role="status" aria-label="Loading users" data-testid="loading-skeleton">
                    {Array.from({ length: 6 }, (_, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-200/80 p-3">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-3 w-32" />
                          <Skeleton className="h-2.5 w-20" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : usersQuery.isError ? (
                  <EmptyState
                    icon={<ServerCrash aria-hidden />}
                    title="Cannot reach server"
                    description="The ExpenseFlow API did not respond. Start the backend and retry, or explore the app with built-in sample data."
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button variant="primary" onClick={() => void usersQuery.refetch()} testId="login-retry">
                          Retry
                        </Button>
                        {launchMock}
                      </div>
                    }
                    testId="login-error"
                  />
                ) : (usersQuery.data ?? []).length === 0 ? (
                  <EmptyState
                    title="No demo users yet"
                    description={
                      <>
                        Run the seed job: <code className="rounded bg-slate-100 px-1">docker compose -f ops/docker-compose.yml run --rm seed</code>
                      </>
                    }
                    action={launchMock}
                    testId="login-empty"
                  />
                ) : visible.length === 0 ? (
                  <p className="py-10 text-center text-sm text-slate-500" data-testid="login-no-match">
                    No {ROLE_LABEL[tab].toLowerCase()} matches “{search}”.
                  </p>
                ) : (
                  <div role="radiogroup" aria-label={`${ROLE_LABEL[tab]} users`} onKeyDown={onListKey} className="grid gap-2 sm:grid-cols-2">
                    {visible.map((u, i) => {
                      const isSel = u.id === selected;
                      const busy = signingIn === u.id;
                      return (
                        <div
                          key={u.id}
                          id={`login-user-${u.id}`}
                          role="radio"
                          aria-checked={isSel}
                          tabIndex={isSel || (selected === null && i === 0) ? 0 : -1}
                          onClick={() => setSelected(u.id)}
                          onDoubleClick={() => void signIn(u.id)}
                          onFocus={() => setSelected(u.id)}
                          data-testid={`login-user-${u.id}`}
                          className={cn(
                            'group flex cursor-pointer items-center gap-3 rounded-xl border bg-white p-3 transition-all duration-150',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600',
                            isSel ? 'border-indigo-500 shadow-sm ring-1 ring-indigo-500' : 'border-slate-200 hover:border-slate-300 hover:shadow-xs',
                          )}
                        >
                          <span
                            className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold', AVATAR_TONES[u.id % AVATAR_TONES.length])}
                            aria-hidden
                          >
                            {initials(u.name)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-900">{u.name}</span>
                            <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1">
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-px text-[11px] font-medium text-slate-600">
                                {u.department ?? u.departmentName ?? '—'}
                              </span>
                              {u.roles.length > 1 && (
                                <span className="truncate text-[11px] text-slate-500">
                                  {u.roles
                                    .filter((r) => r !== 'EMPLOYEE')
                                    .map((r) => ROLE_LABEL[r])
                                    .join(', ')}
                                </span>
                              )}
                            </span>
                          </span>
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-label={`Sign in as ${u.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void signIn(u.id);
                            }}
                            data-testid={`login-quick-${u.id}`}
                            className={cn(
                              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all duration-150',
                              isSel ? 'bg-indigo-600 text-white' : 'text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-700',
                            )}
                          >
                            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
                          </button>
                        </div>
                      );
                    })}
                    {!search && byTab[tab].length > VISIBLE && (
                      <p className="pt-1 text-xs text-slate-500 sm:col-span-2">
                        Showing {VISIBLE} of {byTab[tab].length}. Search to find others.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {loginError && (
                <div className="mt-3">
                  <Banner tone="error" testId="login-failed">
                    {loginError}
                  </Banner>
                </div>
              )}

              <Button
                variant="primary"
                size="lg"
                className="mt-5 w-full"
                disabled={selected === null}
                loading={signingIn !== null}
                onClick={() => void signIn(selected)}
                icon={<LogIn className="h-4 w-4" aria-hidden />}
                testId="login-submit"
              >
                {selectedUser ? `Sign in as ${selectedUser.name}` : 'Select a user to sign in'}
              </Button>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>Tip: click the arrow on a card for one-click sign-in, or use ↑ ↓ and Enter.</span>
                {!mock && !usersQuery.isError && (
                  <button type="button" onClick={() => switchMock(true)} className="font-medium text-indigo-700 hover:underline" data-testid="login-try-demo">
                    Explore with demo data
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
