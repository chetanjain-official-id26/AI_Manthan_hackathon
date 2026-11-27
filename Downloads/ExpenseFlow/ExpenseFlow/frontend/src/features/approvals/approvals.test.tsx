import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { server } from '@/test/server';
import { api, currentPath, ok, problem, renderApp } from '@/test/render';
import { EMPLOYEE_B, MANAGER, claim, delegation, inboxItem } from '@/test/fixtures';

describe('S3a approver inbox (EF-015)', () => {
  it('TC-FE-I01 sorts oldest first with SLA age chips (amber > 24 h, red > 48 h)', async () => {
    server.use(
      http.get(api('/approvals/inbox'), () =>
        ok([
          inboxItem({ claimId: 1, claimNo: 'NEW', ageSeconds: 600 }),
          inboxItem({ claimId: 2, claimNo: 'OLDEST', ageSeconds: 3 * 86400 }),
          inboxItem({ claimId: 3, claimNo: 'MIDDLE', ageSeconds: 30 * 3600 }),
        ]),
      ),
    );
    renderApp('/inbox', { me: MANAGER });
    const rows = await screen.findAllByTestId(/^inbox-row-/);
    expect(rows.map((r) => r.getAttribute('data-claim-id'))).toEqual(['2', '3', '1']);
    expect(within(rows[0] as HTMLElement).getByTestId('age-badge')).toHaveTextContent('3d 0h');
    expect(within(rows[0] as HTMLElement).getByTestId('age-badge').className).toMatch(/red/);
    expect(within(rows[1] as HTMLElement).getByTestId('age-badge').className).toMatch(/amber/);
  });

  it('TC-FE-I02 Enter opens the oldest claim', async () => {
    server.use(
      http.get(api('/approvals/inbox'), () => ok([inboxItem({ claimId: 1, ageSeconds: 10 }), inboxItem({ claimId: 2, ageSeconds: 99_999 })])),
      http.get(api('/claims/2'), () => ok(claim({ id: 2 }))),
    );
    renderApp('/inbox', { me: MANAGER });
    await screen.findAllByTestId(/^inbox-row-/);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(currentPath()).toBe('/claims/2'));
  });

  it('TC-FE-I03 empty inbox shows "Inbox zero 🎉"', async () => {
    renderApp('/inbox', { me: MANAGER });
    expect(await screen.findByTestId('inbox-empty')).toHaveTextContent('Inbox zero 🎉');
  });

  it('TC-FE-I04 delegated items show "on behalf of"; a delegate can open the inbox', async () => {
    server.use(http.get(api('/approvals/inbox'), () => ok([inboxItem({ onBehalfOfName: MANAGER.name })])));
    renderApp('/inbox', { me: { ...EMPLOYEE_B, activeDelegations: [delegation()] } });
    expect(await screen.findByTestId('inbox-row-0')).toHaveTextContent(MANAGER.name);
  });

  it('TC-FE-I05 mobile (360 px) shows inbox cards', async () => {
    window.innerWidth = 360;
    server.use(http.get(api('/approvals/inbox'), () => ok([inboxItem()])));
    renderApp('/inbox', { me: MANAGER });
    expect(await screen.findByTestId('inbox-card-0')).toBeInTheDocument();
  });
});

describe('S3c delegation (EF-020, EF-021)', () => {
  it('TC-FE-G01 the delegate list excludes yourself', async () => {
    renderApp('/settings/delegation', { me: MANAGER });
    const select = await screen.findByTestId('delegate-select');
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1));
    const labels = within(select).getAllByRole('option').map((o) => o.textContent ?? '');
    expect(labels.some((l) => l.includes(MANAGER.name))).toBe(false);
    expect(labels.some((l) => l.includes(EMPLOYEE_B.name))).toBe(true);
  });

  it('TC-FE-G02 client validation: delegate and reason required; end ≥ start', async () => {
    renderApp('/settings/delegation', { me: MANAGER });
    await userEvent.click(await screen.findByTestId('delegation-submit'));
    expect(screen.getByTestId('delegate-select-error')).toBeInTheDocument();
    expect(screen.getByTestId('delegation-reason-error')).toBeInTheDocument();
  });

  it('TC-FE-G03 (R3, TC-SEC-03) a cycle rejected by the server shows "would create a delegation loop"', async () => {
    server.use(http.post(api('/delegations'), () => problem(422, 'Delegation cycle detected')));
    renderApp('/settings/delegation', { me: MANAGER });
    const select = await screen.findByTestId('delegate-select');
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1));
    await userEvent.selectOptions(select, String(EMPLOYEE_B.id));
    await userEvent.type(screen.getByTestId('delegation-reason'), 'Leave');
    await userEvent.click(screen.getByTestId('delegation-submit'));
    expect(await screen.findByTestId('delegation-error')).toHaveTextContent(/delegation loop/);
  });

  it('TC-FE-G04 creating a delegation posts dates and reason', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(api('/delegations'), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return ok(delegation());
      }),
    );
    renderApp('/settings/delegation', { me: MANAGER });
    const select = await screen.findByTestId('delegate-select');
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1));
    await userEvent.selectOptions(select, String(EMPLOYEE_B.id));
    await userEvent.type(screen.getByTestId('delegation-reason'), 'Annual leave');
    await userEvent.click(screen.getByTestId('delegation-submit'));
    await waitFor(() => expect(body).toMatchObject({ delegateId: EMPLOYEE_B.id, reason: 'Annual leave' }));
    expect(body?.fromDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('TC-FE-G05 an active delegation can be revoked after confirmation', async () => {
    let deleted = false;
    server.use(
      http.get(api('/delegations'), () => ok([delegation({ id: 7, delegatorId: MANAGER.id })])),
      http.delete(api('/delegations/7'), () => {
        deleted = true;
        return new Response(null, { status: 204 });
      }),
    );
    renderApp('/settings/delegation', { me: MANAGER });
    expect(await screen.findByTestId('delegation-7')).toHaveTextContent('Active');
    await userEvent.click(screen.getByTestId('delegation-revoke-7'));
    await userEvent.click(await screen.findByTestId('revoke-confirm'));
    await waitFor(() => expect(deleted).toBe(true));
  });
});
