import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { isMockMode } from '@/api/mock/mode';
import { server } from '@/test/server';
import { api, currentPath, ok, problem, renderApp } from '@/test/render';
import { EMPLOYEE, MANAGER, claim } from '@/test/fixtures';

describe('Login split layout and demo mock fallback', () => {
  it('TC-FE-UX01 API status pill reflects the backend; tabs never wrap', async () => {
    renderApp('/login');
    await waitFor(() => expect(screen.getAllByTestId('api-status')[0]).toHaveTextContent('API connected'));
    for (const r of ['EMPLOYEE', 'MANAGER', 'AUDITOR', 'FINANCE_HEAD']) expect(screen.getByTestId(`login-tab-${r}`).className).toContain('whitespace-nowrap');
  });

  it('TC-FE-UX02 one-click sign-in from a user card', async () => {
    server.use(
      http.post(api('/auth/demo-login'), () => ok({ token: 't', expiresAt: new Date(Date.now() + 3600_000).toISOString(), user: EMPLOYEE })),
      http.get(api('/me'), () => ok(EMPLOYEE)),
    );
    renderApp('/login');
    await userEvent.click(await screen.findByTestId(`login-quick-${EMPLOYEE.id}`));
    await waitFor(() => expect(currentPath()).toBe('/home'));
  });

  it('TC-FE-UX03 server unreachable → "Launch with Demo Mock Data" runs the app on in-memory data', async () => {
    server.use(http.get(api('/auth/demo-users'), () => problem(503, 'down')));
    renderApp('/login');
    await userEvent.click(await screen.findByTestId('login-launch-mock', {}, { timeout: 6000 }));
    expect(isMockMode()).toBe(true);
    expect(await screen.findByTestId('login-demo-banner')).toBeInTheDocument();
    // Mock personas appear (no network involved) and sign-in works end to end.
    await userEvent.click(await screen.findByTestId('login-tab-MANAGER'));
    const card = await screen.findByTestId('login-user-10');
    expect(card).toHaveTextContent('Meera Iyer');
    await userEvent.click(within(card).getByTestId('login-quick-10'));
    expect(await screen.findByTestId('home-greeting', {}, { timeout: 6000 })).toHaveTextContent('Hello, Meera');
    expect(screen.getByTestId('demo-mode-pill')).toBeInTheDocument();
    await waitFor(() => expect(Number(screen.getByTestId('home-inbox-value').textContent)).toBeGreaterThan(0), { timeout: 6000 });
  });
});

describe('App shell', () => {
  it('TC-FE-UX04 "?" opens the keyboard shortcuts modal from any screen', async () => {
    renderApp('/home', { me: EMPLOYEE });
    await screen.findByTestId('home-greeting');
    await userEvent.keyboard('?');
    const dialog = await screen.findByTestId('shortcuts-dialog');
    expect(dialog).toHaveTextContent('Approve');
    expect(dialog).toHaveTextContent('Next claim in your inbox');
  });

  it('TC-FE-UX05 sidebar collapses to an icon rail and expands again', async () => {
    renderApp('/home', { me: MANAGER });
    const sidebar = await screen.findByTestId('sidebar');
    expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    await userEvent.click(within(sidebar).getByTestId('sidebar-toggle'));
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'true');
    // labels stay available to assistive tech
    expect(within(screen.getByTestId('sidebar')).getByTestId('nav-inbox')).toHaveAccessibleName('Inbox');
    await userEvent.click(within(screen.getByTestId('sidebar')).getByTestId('sidebar-toggle'));
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-collapsed', 'false');
  });

  it('TC-FE-UX06 top bar: breadcrumbs show the claim number; New claim and user menu', async () => {
    server.use(http.get(api('/claims/501'), () => ok(claim())));
    renderApp('/claims/501', { me: MANAGER });
    await waitFor(() => expect(screen.getByTestId('breadcrumbs')).toHaveTextContent('CLM-2026-0501'));
    expect(screen.getByTestId('topbar-new-claim')).toHaveAttribute('href', '/claims/new');
    await userEvent.click(screen.getByTestId('user-menu'));
    expect(screen.getByTestId('user-menu-panel')).toHaveTextContent(MANAGER.name);
    await userEvent.click(screen.getByTestId('topbar-switch-user'));
    expect(await screen.findByTestId('login-card')).toBeInTheDocument();
  });
});
