import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { server } from '@/test/server';
import { api, ok, problem, renderApp } from '@/test/render';
import { AUDITOR, FINANCE_HEAD, MANAGER, page, rule } from '@/test/fixtures';

describe('S6 dashboard (EF-029, EF-030)', () => {
  const dashHandlers = () =>
    server.use(
      http.get(api('/dashboard/spend-by-category'), () => ok([{ category: 'MEAL', total: '120000.00' }, { category: 'HOTEL', total: '5000.50' }])),
      http.get(api('/dashboard/spend-by-department'), () => ok([{ department: 'Sales', total: '9000' }])),
      http.get(api('/dashboard/spend-by-month'), () => ok([{ month: '2026-10', total: '100' }, { month: '2026-11', total: '200' }])),
      http.get(api('/dashboard/violations'), () =>
        ok([
          { ruleCode: 'DUPLICATE_RECEIPT_HASH', count: 15 },
          { ruleCode: 'DUPLICATE_VENDOR_AMOUNT_DATE', count: 40 },
          { ruleCode: 'WEEKEND_SPEND', count: 50 },
        ]),
      ),
      http.get(api('/dashboard/approval-time'), () => ok([{ department: 'Sales', avgHours: 10 }, { department: 'Ops', avgHours: 20 }])),
      http.get(api('/dashboard/kpis'), () => ok({ pendingClaims: 42, oldestPendingSeconds: 50 * 3600 })),
    );

  it('TC-FE-DB01 KPI tiles: avg approval time, pending, oldest, duplicates caught', async () => {
    dashHandlers();
    renderApp('/dashboard', { me: FINANCE_HEAD });
    // first render imports the lazy, Recharts-heavy chunk
    await screen.findByTestId('kpi-tiles', {}, { timeout: 15_000 });
    await waitFor(() => expect(screen.getByTestId('kpi-duplicates')).toHaveTextContent('55'));
    expect(screen.getByTestId('kpi-avg-approval')).toHaveTextContent('15h 0m');
    expect(screen.getByTestId('kpi-pending')).toHaveTextContent('42');
    expect(screen.getByTestId('kpi-oldest')).toHaveTextContent('2d 2h');
  });

  it('TC-FE-DB02 every chart has a "View as table" toggle with exact INR values', async () => {
    dashHandlers();
    renderApp('/dashboard', { me: FINANCE_HEAD });
    for (const id of ['chart-category', 'chart-department', 'chart-month', 'chart-violations', 'chart-approval-time']) {
      expect(await screen.findByTestId(`${id}-toggle`)).toHaveTextContent('View as table');
    }
    await userEvent.click(screen.getByTestId('chart-category-toggle'));
    const table = await screen.findByTestId('chart-category-table');
    expect(table).toHaveTextContent('Meal');
    expect(table).toHaveTextContent('₹1,20,000.00');
    expect(screen.getByTestId('chart-category-toggle')).toHaveAttribute('aria-pressed', 'true');
  });

  it('TC-FE-DB03 date range is sent to the API; missing /kpis degrades to "—"', async () => {
    dashHandlers();
    const seen: (string | null)[] = [];
    server.use(
      http.get(api('/dashboard/spend-by-category'), ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('from'));
        return ok([]);
      }),
      http.get(api('/dashboard/kpis'), () => problem(404, 'nope')),
    );
    renderApp('/dashboard', { me: MANAGER });
    const from = await screen.findByTestId('dash-from');
    await userEvent.type(from, '2026-11-01');
    await waitFor(() => expect(seen).toContain('2026-11-01'));
    await waitFor(() => expect(screen.getByTestId('kpi-pending')).toHaveTextContent('—'));
  });

  it('TC-FE-DB04 (R7) finance head sees recent policy rule changes; manager does not', async () => {
    dashHandlers();
    server.use(http.get(api('/admin/policy-rules'), () => ok([rule(), rule({ id: 2, version: 2, limitAmount: '2000.00', reason: 'demo', createdByName: 'Priya Nair', createdAt: '2026-11-27T05:00:00Z' })])));
    const { unmount } = renderApp('/dashboard', { me: FINANCE_HEAD });
    expect(await screen.findByTestId('dash-rule-changes')).toHaveTextContent('Meal daily limit v2');
    unmount();
    renderApp('/dashboard', { me: MANAGER });
    await screen.findByTestId('kpi-tiles');
    expect(screen.queryByTestId('dash-rule-changes')).not.toBeInTheDocument();
  });
});

describe('S7 audit trail (EF-032)', () => {
  const event = {
    id: 1,
    entityType: 'APPROVAL_STEP',
    entityId: 10,
    action: 'STEP_APPROVED',
    actorName: 'Rohit Verma',
    onBehalfOfName: 'Meera Iyer',
    before: { status: 'PENDING_MANAGER', version: 3 },
    after: { status: 'PENDING_AUDITOR', version: 4 },
    createdAt: '2026-11-27T05:00:00Z',
  };

  it('TC-FE-AU01 rows show IST time, actor, on behalf of; expanding shows the before → after diff', async () => {
    server.use(http.get(api('/audit'), () => ok(page([event]))));
    renderApp('/audit', { me: AUDITOR });
    const row = await screen.findByTestId('audit-row-1');
    expect(row).toHaveTextContent('Rohit Verma');
    expect(row).toHaveTextContent('Meera Iyer');
    expect(row).toHaveTextContent('10:30 IST');
    await userEvent.click(screen.getByTestId('audit-expand-1'));
    const diff = await screen.findByTestId('audit-diff');
    expect(diff).toHaveTextContent('PENDING_MANAGER');
    expect(diff).toHaveTextContent('PENDING_AUDITOR');
  });

  it('TC-FE-AU02 claim filter: claim no → claimNo, numeric → claimId; no edit controls', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get(api('/audit'), ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return ok(page([event]));
      }),
    );
    renderApp('/audit', { me: AUDITOR });
    await userEvent.type(await screen.findByTestId('audit-claim'), 'CLM-2026-0142');
    await waitFor(() => expect(seen.at(-1)?.get('claimNo')).toBe('CLM-2026-0142'));
    await userEvent.clear(screen.getByTestId('audit-claim'));
    await userEvent.type(screen.getByTestId('audit-claim'), '142');
    await waitFor(() => expect(seen.at(-1)?.get('claimId')).toBe('142'));
    expect(screen.queryByRole('button', { name: /delete|edit/i })).not.toBeInTheDocument();
  });
});

describe('S8 policy rules (EF-014, EF-041, R7)', () => {
  const rules = [rule(), rule({ id: 2, ruleCode: 'HOTEL_NIGHTLY_LIMIT', category: 'HOTEL', cityTier: 'TIER_1', limitAmount: '6000.00', unit: 'PER_NIGHT' })];

  it('TC-FE-PR01 banner explains changes apply to new submissions; auditor is read-only', async () => {
    server.use(http.get(api('/admin/policy-rules'), () => ok(rules)));
    renderApp('/admin/policies', { me: AUDITOR });
    expect(await screen.findByTestId('policy-banner')).toHaveTextContent('Changes apply to new submissions only.');
    await screen.findByTestId('policy-row-MEAL_DAILY_LIMIT');
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('TC-FE-PR02 (TC-POL-21) edit requires a reason and posts a new version with its slot', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get(api('/admin/policy-rules'), () => ok(rules)),
      http.post(api('/admin/policy-rules/MEAL_DAILY_LIMIT/versions'), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return ok(rule({ version: 2, limitAmount: '2000.00' }));
      }),
    );
    renderApp('/admin/policies', { me: FINANCE_HEAD });
    const row = await screen.findByTestId('policy-row-MEAL_DAILY_LIMIT');
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Edit' })).toBeEnabled());
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    const limit = await screen.findByTestId('policy-limit');
    await userEvent.clear(limit);
    await userEvent.type(limit, '2000');
    await userEvent.click(screen.getByTestId('policy-edit-save'));
    expect(screen.getByTestId('policy-reason-error')).toHaveTextContent(/reason is required/);
    await userEvent.type(screen.getByTestId('policy-reason'), 'demo');
    await userEvent.click(screen.getByTestId('policy-edit-save'));
    await waitFor(() => expect(body).toMatchObject({ limitAmount: '2000', action: 'ROUTE', active: true, reason: 'demo', category: 'MEAL', cityTier: null }));
    expect(String(body?.effectiveFrom)).toMatch(/\+05:30$/);
  });

  it('TC-FE-PR03 (R7, TC-SEC-05) 409 when the finance head has a claim in flight shows the blocked state', async () => {
    server.use(
      http.get(api('/admin/policy-rules'), () => ok(rules)),
      http.post(api('/admin/policy-rules/MEAL_DAILY_LIMIT/versions'), () => problem(409, 'Editor has a claim in flight')),
    );
    renderApp('/admin/policies', { me: FINANCE_HEAD });
    const row = await screen.findByTestId('policy-row-MEAL_DAILY_LIMIT');
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Edit' })).toBeEnabled());
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    await userEvent.type(await screen.findByTestId('policy-reason'), 'raise');
    await userEvent.click(screen.getByTestId('policy-edit-save'));
    expect(await screen.findByTestId('policy-blocked')).toHaveTextContent('You have a claim in flight');
  });

  it('TC-FE-PR04 (R7) editing is disabled up front when own claims are pending', async () => {
    server.use(
      http.get(api('/admin/policy-rules'), () => ok(rules)),
      http.get(api('/claims'), ({ request }) => ok(page([], { totalElements: new URL(request.url).searchParams.get('status') === 'PENDING_MANAGER' ? 1 : 0 }))),
    );
    renderApp('/admin/policies', { me: FINANCE_HEAD });
    expect(await screen.findByTestId('policy-blocked')).toBeInTheDocument();
    const row = screen.getByTestId('policy-row-MEAL_DAILY_LIMIT');
    expect(within(row).getByRole('button', { name: 'Edit' })).toBeDisabled();
  });

  it('TC-FE-PR05 (EF-041) history drawer offers rollback, prefilled as a new version', async () => {
    server.use(http.get(api('/admin/policy-rules'), () => ok([rule({ id: 1, version: 1, active: false, limitAmount: '1500.00' }), rule({ id: 3, version: 2, limitAmount: '2000.00' })])));
    renderApp('/admin/policies', { me: FINANCE_HEAD });
    const row = await screen.findByTestId('policy-row-MEAL_DAILY_LIMIT');
    await userEvent.click(within(row).getByRole('button', { name: 'History' }));
    await waitFor(() => expect(screen.getByTestId('policy-rollback-1')).toBeEnabled());
    await userEvent.click(screen.getByTestId('policy-rollback-1'));
    expect(await screen.findByTestId('policy-limit')).toHaveValue('1500.00');
    expect(screen.getByTestId('policy-reason')).toHaveValue('Roll back to v1: ');
    expect(screen.getByTestId('policy-edit-save')).toHaveTextContent('Save as v3');
  });
});
