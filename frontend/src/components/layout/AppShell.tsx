import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Keyboard,
  LogOut,
  Menu,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Repeat,
  Settings2,
} from 'lucide-react';
import { claimsApi } from '@/api/claims';
import { qk } from '@/api/keys';
import { disableMockMode, isMockMode } from '@/api/mock/mode';
import { payoutsApi } from '@/api/payouts';
import { useMe, useAuth } from '@/features/auth/AuthContext';
import { actingFor, hasRole, primaryRole } from '@/features/auth/permissions';
import { RoleBadge } from '@/components/ui/Chips';
import { Modal } from '@/components/ui/Modal';
import { useMediaQuery } from '@/hooks';
import { initials } from '@/utils/labels';
import { cn } from '@/utils/misc';
import { formatISTDate } from '@/utils/time';
import { NAV_ITEMS, type NavItem } from './nav';
import { ShortcutsProvider, useShortcuts } from './Shortcuts';

const COLLAPSE_KEY = 'ef.sidebarCollapsed';

function readCollapsed(): boolean | null {
  try {
    const v = localStorage.getItem(COLLAPSE_KEY);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

function Logo({ className }: { className?: string }) {
  return <img src="/favicon.svg" alt="" className={cn('h-7 w-7 shrink-0', className)} />;
}

function SideLink({ item, collapsed, onClick }: { item: NavItem; collapsed: boolean; onClick?: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      onClick={onClick}
      data-testid={item.testId}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-all duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
          collapsed && 'justify-center px-0',
          isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-indigo-400" aria-hidden />}
          <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
          <span className={cn('truncate', collapsed && 'sr-only')}>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

/** Drawer / sheet link (light surface). */
function DrawerLink({ item, onClick }: { item: NavItem; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      onClick={onClick}
      data-testid={`d-${item.testId}`}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150',
          isActive ? 'bg-indigo-50 text-indigo-800' : 'text-slate-700 hover:bg-slate-100',
        )
      }
    >
      <Icon className="h-4 w-4" aria-hidden />
      {item.label}
    </NavLink>
  );
}

// ---------------------------------------------------------------- breadcrumbs
interface Crumb {
  label: string;
  to?: string;
}

function useCrumbs(pathname: string): Crumb[] {
  const claimMatch = /^\/claims\/(\d+)(\/edit)?$/.exec(pathname);
  const batchMatch = /^\/payouts\/(\d+)$/.exec(pathname);
  const claimId = claimMatch ? Number(claimMatch[1]) : 0;
  const batchId = batchMatch ? Number(batchMatch[1]) : 0;
  // Subscribe to cached detail data (never fetches) so the crumb shows the claim/batch number once loaded.
  const claim = useQuery({ queryKey: qk.claim(claimId), queryFn: () => claimsApi.get(claimId), enabled: false });
  const batch = useQuery({ queryKey: qk.payout(batchId), queryFn: () => payoutsApi.get(batchId), enabled: false });

  if (pathname === '/claims/new') return [{ label: 'My claims', to: '/claims' }, { label: 'New claim' }];
  if (claimMatch) {
    const label = claim.data?.claimNo ?? `Claim #${claimId}`;
    return claimMatch[2] ? [{ label: 'Claims', to: '/claims' }, { label, to: `/claims/${claimId}` }, { label: 'Edit' }] : [{ label: 'Claims', to: '/claims' }, { label }];
  }
  if (batchMatch) return [{ label: 'Payouts', to: '/payouts' }, { label: batch.data ? `Batch ${batch.data.batchNo}` : `Batch #${batchId}` }];
  const nav = NAV_ITEMS.find((n) => pathname === n.to || pathname.startsWith(`${n.to}/`));
  return [{ label: nav?.label ?? 'ExpenseFlow' }];
}

function Breadcrumbs() {
  const { pathname } = useLocation();
  const crumbs = useCrumbs(pathname);
  return (
    <nav aria-label="Breadcrumb" className="min-w-0" data-testid="breadcrumbs">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={`${c.label}-${i}`} className={cn('flex min-w-0 items-center gap-1.5', !last && 'hidden sm:flex')}>
              {c.to && !last ? (
                <Link to={c.to} className="truncate text-slate-500 transition-colors hover:text-slate-900">
                  {c.label}
                </Link>
              ) : (
                <span className={cn('truncate', last ? 'font-medium text-slate-900' : 'text-slate-500')} aria-current={last ? 'page' : undefined}>
                  {c.label}
                </span>
              )}
              {!last && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-300" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------- user menu
function UserMenu({ onSwitch, onExitDemo }: { onSwitch: () => void; onExitDemo: () => void }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const mock = isMockMode();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="user-menu"
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors duration-150 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white" aria-hidden>
          {initials(me.name)}
        </span>
        <span className="hidden text-left lg:block">
          <span className="block max-w-[10rem] truncate text-sm font-medium leading-4 text-slate-900">{me.name}</span>
          <span className="block text-xs leading-4 text-slate-500">{primaryRole(me.roles).replace('_', ' ').toLowerCase().replace(/^\w|\s\w/g, (c) => c.toUpperCase())}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-slate-400 lg:block" aria-hidden />
        <span className="sr-only">Open user menu</span>
      </button>
      {open && (
        <div role="menu" className="ef-toast absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl ring-1 ring-black/5" data-testid="user-menu-panel">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-900">{me.name}</p>
            <p className="truncate text-xs text-slate-500">
              {me.department ?? me.departmentName ?? ''}
              {me.email ? ` · ${me.email}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {me.roles.map((r) => (
                <RoleBadge key={r} role={r} />
              ))}
            </div>
          </div>
          <div className="p-1.5">
            {hasRole(me, 'MANAGER', 'AUDITOR', 'FINANCE_HEAD') && (
              <Link role="menuitem" to="/settings/delegation" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                <Settings2 className="h-4 w-4 text-slate-400" aria-hidden /> Delegation settings
              </Link>
            )}
            <button role="menuitem" type="button" onClick={onSwitch} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100" data-testid="topbar-switch-user">
              <Repeat className="h-4 w-4 text-slate-400" aria-hidden /> Switch user / Logout
            </button>
            {mock && (
              <button role="menuitem" type="button" onClick={onExitDemo} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-amber-800 hover:bg-amber-50" data-testid="topbar-exit-demo">
                <FlaskConical className="h-4 w-4" aria-hidden /> Exit demo mode
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- shell
function Shell() {
  const me = useMe();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const shortcuts = useShortcuts();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const [moreOpen, setMoreOpen] = useState(false);
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(() => readCollapsed());
  const collapsed = userCollapsed ?? !isDesktop; // tablets default to the icon rail
  const mock = isMockMode();

  const items = NAV_ITEMS.filter((i) => i.visible(me));
  const role = primaryRole(me.roles);
  const delegations = actingFor(me);
  const bottom = items.length > 5 ? items.slice(0, 4) : items;
  const overflow = items.length > 5 ? items.slice(4) : [];

  function toggleSidebar() {
    const next = !collapsed;
    setUserCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  function switchUser() {
    logout();
    navigate('/login', { replace: true });
  }
  function exitDemo() {
    disableMockMode();
    switchUser();
  }

  const style = { '--sidebar-w': collapsed ? '4rem' : '16rem' } as CSSProperties;

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-slate-50" style={style}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[200] focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>

      {/* ---------- sidebar (tablet + desktop) ---------- */}
      <aside
        className="relative hidden shrink-0 flex-col bg-slate-950 text-slate-300 transition-[width] duration-200 ease-out md:flex"
        style={{ width: 'var(--sidebar-w)' }}
        aria-label="Sidebar"
        data-collapsed={collapsed}
        data-testid="sidebar"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_60%_at_0%_0%,rgba(99,102,241,0.18),transparent_60%)]" aria-hidden />
        <div className={cn('relative flex h-14 shrink-0 items-center border-b border-white/5', collapsed ? 'justify-center px-2' : 'justify-between px-4')}>
          <Link to="/home" className="flex min-w-0 items-center gap-2.5" aria-label="ExpenseFlow home">
            <Logo />
            {!collapsed && <span className="truncate text-[15px] font-semibold tracking-tight text-white">ExpenseFlow</span>}
          </Link>
          {!collapsed && (
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="Collapse sidebar"
              data-testid="sidebar-toggle"
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            >
              <PanelLeftClose className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
        {collapsed && (
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Expand sidebar"
            data-testid="sidebar-toggle"
            className="relative mx-auto mt-3 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            <PanelLeftOpen className="h-4 w-4" aria-hidden />
          </button>
        )}
        <nav className={cn('ef-sidebar-scroll relative flex-1 space-y-0.5 overflow-y-auto py-3', collapsed ? 'px-2' : 'px-3')} aria-label="Main navigation">
          {!collapsed && <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">Workspace</p>}
          {items.map((i) => (
            <SideLink key={i.to} item={i} collapsed={collapsed} />
          ))}
        </nav>
        <div className={cn('relative space-y-3 border-t border-white/5', collapsed ? 'p-2' : 'p-3')}>
          {!collapsed && (
            <div className="flex items-center gap-3 rounded-lg bg-white/5 p-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-sm font-semibold text-white" aria-hidden>
                {initials(me.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white" data-testid="current-user-name">
                  {me.name}
                </p>
                <RoleBadge role={role} dark />
              </div>
            </div>
          )}
          {!collapsed && delegations.length > 0 && (
            <p className="rounded-lg border border-violet-400/20 bg-violet-500/10 px-2.5 py-1.5 text-xs text-violet-200" data-testid="acting-for">
              Acting for {delegations.map((d) => d.delegatorName ?? `#${d.delegatorId}`).join(', ')}
            </p>
          )}
          <button
            type="button"
            onClick={switchUser}
            data-testid="switch-user"
            title="Switch user / Logout"
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 py-2 text-sm font-medium text-slate-300 transition-colors duration-150 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
              collapsed ? 'px-0' : 'px-3',
            )}
          >
            <Repeat className="h-4 w-4" aria-hidden />
            <span className={cn(collapsed && 'sr-only')}>Switch user / Logout</span>
          </button>
        </div>
      </aside>

      {/* ---------- main column ---------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-label="Open menu"
              data-testid="mobile-menu"
              className="-ml-1 rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 md:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden />
            </button>
            <Link to="/home" className="flex items-center gap-2 md:hidden" aria-label="ExpenseFlow home">
              <Logo className="h-6 w-6" />
            </Link>
            <Breadcrumbs />
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {mock && (
              <span
                className="hidden items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800 sm:inline-flex"
                title="Data comes from an in-memory demo backend in this tab"
                data-testid="demo-mode-pill"
              >
                <FlaskConical className="h-3 w-3" aria-hidden /> Demo data
              </span>
            )}
            {location.pathname !== '/claims/new' && (
              <Link
                to="/claims/new"
                data-testid="topbar-new-claim"
                aria-label="New claim"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 text-sm font-medium text-white shadow-xs transition-all duration-150 hover:bg-indigo-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 sm:px-3.5"
              >
                <Plus className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">New claim</span>
              </Link>
            )}
            <button
              type="button"
              onClick={shortcuts.open}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              data-testid="topbar-shortcuts"
              className="hidden h-9 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-sm text-slate-600 transition-colors duration-150 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 md:inline-flex"
            >
              <Keyboard className="h-4 w-4" aria-hidden />
              <kbd className="font-mono text-xs">?</kbd>
            </button>
            <UserMenu onSwitch={switchUser} onExitDemo={exitDemo} />
          </div>
        </header>

        <main id="main" tabIndex={-1} className="ef-scroll flex-1 overflow-y-auto focus:outline-none">
          <div className="w-full px-4 pb-24 pt-5 md:px-6 md:pb-10 lg:px-8 lg:pt-6">
            <Outlet />
          </div>
        </main>
      </div>

      {/* ---------- mobile bottom navigation ---------- */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex h-14 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Quick navigation"
      >
        {bottom.map((i) => {
          const Icon = i.icon;
          return (
            <NavLink
              key={i.to}
              to={i.to}
              data-testid={`m-${i.testId}`}
              className={({ isActive }) =>
                cn(
                  'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600',
                  isActive ? 'text-indigo-700' : 'text-slate-500',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-indigo-600" aria-hidden />}
                  <Icon className="h-5 w-5" aria-hidden />
                  <span className="max-w-full truncate px-1">{i.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
        {overflow.length > 0 && (
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            data-testid="m-nav-more"
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-600',
              overflow.some((o) => location.pathname.startsWith(o.to)) ? 'text-indigo-700' : 'text-slate-500',
            )}
          >
            <MoreHorizontal className="h-5 w-5" aria-hidden />
            More
          </button>
        )}
      </nav>

      {/* ---------- mobile slide-over drawer ---------- */}
      <Modal open={moreOpen} onClose={() => setMoreOpen(false)} title="Menu" variant="drawer" testId="mobile-drawer">
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white" aria-hidden>
              {initials(me.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-900">{me.name}</p>
              <div className="mt-0.5 flex flex-wrap gap-1">
                {me.roles.map((r) => (
                  <RoleBadge key={r} role={r} />
                ))}
              </div>
            </div>
          </div>
          {delegations.length > 0 && (
            <p className="rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900">
              Acting for {delegations.map((d) => `${d.delegatorName ?? `#${d.delegatorId}`} until ${formatISTDate(d.toDate)}`).join(', ')}
            </p>
          )}
          {mock && (
            <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <FlaskConical className="h-3.5 w-3.5" aria-hidden /> Demo data mode
            </p>
          )}
          <nav className="space-y-0.5" aria-label="All pages">
            {items.map((i) => (
              <DrawerLink key={i.to} item={i} onClick={() => setMoreOpen(false)} />
            ))}
          </nav>
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={switchUser}
              data-testid="m-switch-user"
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
            >
              <LogOut className="h-4 w-4" aria-hidden /> Switch user / Logout
            </button>
            {mock && (
              <button type="button" onClick={exitDemo} className="w-full rounded-lg px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50" data-testid="m-exit-demo">
                Exit demo mode
              </button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function AppShell() {
  return (
    <ShortcutsProvider>
      <Shell />
    </ShortcutsProvider>
  );
}
