import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { server } from '@/test/server';
import { api, currentPath, ok, renderApp } from '@/test/render';
import { AUDITOR, EMPLOYEE, EMPLOYEE_B, FINANCE_HEAD, MANAGER, claim, delegation, inboxItem, page, queueItem } from '@/test/fixtures';

describe('Role home — dedicated tasks per persona', () => {
  it('TC-FE-H01 employee: new claim, sent back, drafts, in flight', async () => {
    server.use(
      http.get(api('/claims'), ({ request }) => {
        const s = new URL(request.url).searchParams.get('status');
        const n = s === 'SENT_BACK' ? 2 : s === 'DRAFT' ? 1 : s === 'PENDING_MANAGER' ? 3 : 0;
        return ok(page([], { totalElements: n }));
      }),
    );
    renderApp('/home', { me: EMPLOYEE });
    expect(await screen.findByTestId('home-new-claim')).toHaveAttribute('href', '/claims/new');
    await waitFor(() => expect(screen.getByTestId('home-sent-back-value')).toHaveTextContent('2'));
    expect(screen.getByTestId('home-drafts-value')).toHaveTextContent('1');
    expect(screen.getByTestId('home-in-flight-value')).toHaveTextContent('3');
    expect(screen.getByTestId('home-sent-back')).toHaveAttribute('href', '/claims?status=SENT_BACK');
    expect(screen.queryByTestId('home-approver')).not.toBeInTheDocument();
    expect(screen.queryByTestId('home-finance')).not.toBeInTheDocument();
  });

  it('TC-FE-H02 manager: inbox count and one-click "review oldest"', async () => {
    server.use(
      http.get(api('/approvals/inbox'), () =>
        ok([inboxItem({ claimId: 1, claimNo: 'CLM-1', ageSeconds: 100 }), inboxItem({ claimId: 2, claimNo: 'CLM-2', ageSeconds: 200_000 })]),
      ),
      http.get(api('/claims/2'), () => ok(claim({ id: 2, claimNo: 'CLM-2' }))),
    );
    renderApp('/home', { me: MANAGER });
    await waitFor(() => expect(screen.getByTestId('home-inbox-value')).toHaveTextContent('2'));
    expect(screen.getByText(/Oldest: CLM-2/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('home-start-review'));
    await waitFor(() => expect(currentPath()).toBe('/claims/2'));
  });

  it('TC-FE-H03 manager on leave sees their active delegation', async () => {
    server.use(http.get(api('/delegations'), () => ok([delegation()])));
    renderApp('/home', { me: MANAGER });
    await waitFor(() => expect(screen.getByTestId('home-delegation-value')).toHaveTextContent('On'));
    expect(screen.getByTestId('home-delegation')).toHaveTextContent(EMPLOYEE_B.name);
  });

  it('TC-FE-H04 delegate (plain employee) gets an approvals section and a banner', async () => {
    renderApp('/home', { me: { ...EMPLOYEE_B, activeDelegations: [delegation()] } });
    expect(await screen.findByTestId('home-delegate-banner')).toHaveTextContent(MANAGER.name);
    expect(screen.getByTestId('home-approver')).toBeInTheDocument();
    expect(screen.getByTestId('home-acting-for')).toBeInTheDocument();
  });

  it('TC-FE-H05 auditor: queue, sample, duplicates, split suspects', async () => {
    server.use(
      http.get(api('/auditor/queue'), ({ request }) => {
        const sp = new URL(request.url).searchParams;
        const n = sp.get('sample') ? 4 : sp.get('flag') === 'DUPLICATE' ? 6 : sp.get('flag') === 'SPLIT_SUSPECT' ? 1 : 25;
        return ok(page([queueItem()], { totalElements: n }));
      }),
    );
    renderApp('/home', { me: AUDITOR });
    await waitFor(() => expect(screen.getByTestId('home-queue-value')).toHaveTextContent('25'));
    expect(screen.getByTestId('home-sample-value')).toHaveTextContent('4');
    expect(screen.getByTestId('home-duplicates-value')).toHaveTextContent('6');
    expect(screen.getByTestId('home-split-value')).toHaveTextContent('1');
    expect(screen.getByTestId('home-duplicates')).toHaveAttribute('href', '/auditor?flag=DUPLICATE');
    expect(screen.queryByTestId('home-finance')).not.toBeInTheDocument();
  });

  it('TC-FE-H06 finance head: ready to pay, open batches, policy, dashboard', async () => {
    server.use(
      http.get(api('/payouts/eligible'), () => ok([claim({ id: 1, totalAmount: '1000.10' }), claim({ id: 2, totalAmount: '2000.20' })])),
      http.get(api('/payouts'), () => ok([{ id: 1, batchNo: 'B1', status: 'EXPORTED', claimCount: 1, totalAmount: '1', version: 1 }])),
    );
    renderApp('/home', { me: FINANCE_HEAD });
    await waitFor(() => expect(screen.getByTestId('home-eligible-value')).toHaveTextContent('2'));
    expect(screen.getByTestId('home-eligible')).toHaveTextContent('₹3,000.30');
    expect(screen.getByTestId('home-open-batches-value')).toHaveTextContent('1');
    expect(screen.getByTestId('home-policies')).toHaveAttribute('href', '/admin/policies');
    expect(screen.getByTestId('home-auditor')).toBeInTheDocument();
    expect(screen.getByTestId('home-approver')).toBeInTheDocument();
  });
});
