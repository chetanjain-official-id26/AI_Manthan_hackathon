import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { tokenStore } from '@/api/client';
import { server } from '@/test/server';
import { api, currentPath, ok, problem, renderApp } from '@/test/render';
import { AUDITOR, EMPLOYEE, FINANCE_HEAD, MANAGER } from '@/test/fixtures';

describe('S1 demo sign-in and route guards', () => {
  it('TC-FE-S01 unauthenticated visit redirects to the login page', async () => {
    renderApp('/claims');
    expect(await screen.findByTestId('login-card')).toBeInTheDocument();
    expect(currentPath()).toBe('/login');
  });

  it('TC-FE-S02 users are grouped into role tabs by their highest role', async () => {
    renderApp('/login');
    await waitFor(() => expect(screen.getByTestId('login-tab-EMPLOYEE')).toHaveTextContent('(2)'));
    expect(screen.getByTestId('login-tab-MANAGER')).toHaveTextContent('(1)');
    await userEvent.click(screen.getByTestId('login-tab-FINANCE_HEAD'));
    expect(screen.getByTestId(`login-user-${FINANCE_HEAD.id}`)).toHaveTextContent(FINANCE_HEAD.name);
    expect(screen.queryByTestId(`login-user-${EMPLOYEE.id}`)).not.toBeInTheDocument();
  });

  it('TC-FE-S03 role tabs are keyboard navigable (arrow keys)', async () => {
    renderApp('/login');
    const tab = await screen.findByTestId('login-tab-EMPLOYEE');
    tab.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByTestId('login-tab-MANAGER')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('login-tab-MANAGER')).toHaveFocus();
  });

  it('TC-FE-S04 (EF-035) signing in issues a JWT and lands on the role home', async () => {
    let body: unknown;
    server.use(
      http.post(api('/auth/demo-login'), async ({ request }) => {
        body = await request.json();
        return ok({ token: 'jwt-1', expiresAt: new Date(Date.now() + 3600_000).toISOString(), user: MANAGER });
      }),
      http.get(api('/me'), () => ok(MANAGER)),
    );
    renderApp('/login');
    await userEvent.click(await screen.findByTestId('login-tab-MANAGER'));
    await userEvent.click(screen.getByTestId(`login-user-${MANAGER.id}`));
    await userEvent.click(screen.getByTestId('login-submit'));
    expect(await screen.findByTestId('home-greeting')).toHaveTextContent('Hello, Meera');
    expect(body).toEqual({ employeeId: MANAGER.id });
    expect(tokenStore.get()).toBe('jwt-1');
    expect(currentPath()).toBe('/home');
  });

  it('TC-FE-S05 (TC-SEC-16) rate-limited login shows a clear message', async () => {
    server.use(http.post(api('/auth/demo-login'), () => problem(429, 'Too many requests')));
    renderApp('/login');
    await userEvent.click(await screen.findByTestId(`login-user-${EMPLOYEE.id}`));
    await userEvent.click(screen.getByTestId('login-submit'));
    expect(await screen.findByTestId('login-failed')).toHaveTextContent(/Too many sign-in attempts/);
  });

  it('TC-FE-S06 server unreachable shows retry; empty seed shows hint', async () => {
    server.use(http.get(api('/auth/demo-users'), () => problem(503, 'down')));
    const { unmount } = renderApp('/login');
    // the login page retries once before giving up
    expect(await screen.findByTestId('login-error', {}, { timeout: 5000 })).toHaveTextContent('Cannot reach server');
    unmount();
    server.use(http.get(api('/auth/demo-users'), () => ok([])));
    renderApp('/login');
    expect(await screen.findByTestId('login-empty')).toHaveTextContent('Run the seed job');
  });

  it('TC-FE-S07 expired session shows a banner on the login page', async () => {
    tokenStore.clear('expired');
    renderApp('/login');
    expect(await screen.findByTestId('session-expired')).toHaveTextContent(/session expired/i);
  });

  it('TC-FE-S08 switch user logs out and returns to login', async () => {
    renderApp('/home', { me: EMPLOYEE });
    await userEvent.click(await screen.findByTestId('switch-user'));
    expect(await screen.findByTestId('login-card')).toBeInTheDocument();
    expect(tokenStore.get()).toBeNull();
  });
});

describe('Role-based navigation and guards (RBAC matrix, LLD §6.1)', () => {
  const navIds = async () => {
    const nav = (await screen.findAllByRole('navigation', { name: 'Main navigation' }))[0];
    if (!nav) throw new Error('nav missing');
    return within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('data-testid'));
  };

  it('TC-FE-S09 employee sees only Home and My claims', async () => {
    renderApp('/home', { me: EMPLOYEE });
    expect(await navIds()).toEqual(['nav-home', 'nav-claims']);
  });

  it('TC-FE-S10 manager sees inbox, dashboard and delegation, not payouts or auditor', async () => {
    renderApp('/home', { me: MANAGER });
    const ids = await navIds();
    expect(ids).toEqual(expect.arrayContaining(['nav-inbox', 'nav-dashboard', 'nav-delegation']));
    expect(ids).not.toContain('nav-payouts');
    expect(ids).not.toContain('nav-auditor');
  });

  it('TC-FE-S11 auditor sees queue, audit and policies (read), not payouts', async () => {
    renderApp('/home', { me: AUDITOR });
    const ids = await navIds();
    expect(ids).toEqual(expect.arrayContaining(['nav-auditor', 'nav-audit', 'nav-policies']));
    expect(ids).not.toContain('nav-payouts');
  });

  it('TC-FE-S12 finance head sees every area', async () => {
    renderApp('/home', { me: FINANCE_HEAD });
    expect(await navIds()).toEqual(expect.arrayContaining(['nav-payouts', 'nav-auditor', 'nav-policies', 'nav-audit', 'nav-dashboard']));
  });

  it.each([
    ['/payouts', EMPLOYEE],
    ['/auditor', MANAGER],
    ['/admin/policies', EMPLOYEE],
    ['/audit', MANAGER],
    ['/inbox', EMPLOYEE],
    ['/dashboard', EMPLOYEE],
  ])('TC-FE-S13 %s is redirected home for a user without the role', async (route, me) => {
    renderApp(route, { me });
    await waitFor(() => expect(currentPath()).toBe('/home'));
  });

  it('TC-FE-S14 unknown routes render a not-found page', async () => {
    renderApp('/does-not-exist', { me: EMPLOYEE });
    expect(await screen.findByTestId('not-found')).toBeInTheDocument();
  });

  it('TC-FE-S15 mobile (360 px) shows a bottom navigation bar', async () => {
    window.innerWidth = 360;
    renderApp('/home', { me: FINANCE_HEAD });
    expect(await screen.findByTestId('m-nav-home')).toBeInTheDocument();
    expect(screen.getByTestId('m-nav-more')).toBeInTheDocument();
  });
});
