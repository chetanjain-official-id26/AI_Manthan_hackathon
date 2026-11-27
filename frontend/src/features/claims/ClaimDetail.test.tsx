import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { server } from '@/test/server';
import { api, currentPath, ok, problem, renderApp } from '@/test/render';
import { AUDITOR, EMPLOYEE, EMPLOYEE_B, MANAGER, claim, delegation, inboxItem, line, result, step } from '@/test/fixtures';

describe('S3b claim detail + receipt viewer', () => {
  it('TC-FE-D01 (BR-27, TC-SEC-08) a claim you cannot see renders "Claim not found"', async () => {
    server.use(http.get(api('/claims/999'), () => problem(404, 'Not found')));
    renderApp('/claims/999', { me: EMPLOYEE });
    expect(await screen.findByTestId('not-found')).toHaveTextContent('Claim not found');
  });

  it('TC-FE-D02 (R2, EF-021) the owner never gets approve/reject/send back', async () => {
    server.use(http.get(api('/claims/501'), () => ok(claim({ allowedActions: ['APPROVE'] }))));
    renderApp('/claims/501', { me: EMPLOYEE });
    expect(await screen.findByTestId('readonly-banner')).toHaveTextContent(/own claim/);
    expect(screen.queryByTestId('approve-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reject-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('send-back-btn')).not.toBeInTheDocument();
  });

  it('TC-FE-D03 receipt first: the receipt for the selected line loads; J/K switches lines', async () => {
    server.use(
      http.get(api('/claims/501'), () => ok(claim({ lines: [line({ id: 1, vendor: 'Taj' }), line({ id: 2, vendor: 'Ola', category: 'CAB', receipt: null })] }))),
    );
    renderApp('/claims/501', { me: MANAGER });
    expect(await screen.findByTestId('receipt-viewer-image')).toBeInTheDocument();
    expect(screen.getByTestId('detail-line-0')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('j');
    expect(screen.getByTestId('detail-line-1')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByTestId('receipt-viewer-missing')).toHaveTextContent(/No receipt/);
    await userEvent.keyboard('k');
    expect(screen.getByTestId('detail-line-0')).toHaveAttribute('aria-selected', 'true');
  });

  it('TC-FE-D04 (EF-018, J2) approve sends the version, then auto-opens the next oldest claim', async () => {
    let body: unknown;
    let inboxCalls = 0;
    server.use(
      http.get(api('/claims/501'), () => ok(claim({ version: 3 }))),
      http.get(api('/claims/502'), () => ok(claim({ id: 502, claimNo: 'CLM-2026-0502' }))),
      http.post(api('/claims/501/approve'), async ({ request }) => {
        body = await request.json();
        return ok(claim({ status: 'APPROVED' }));
      }),
      http.get(api('/approvals/inbox'), () => {
        inboxCalls += 1;
        return ok(inboxCalls === 1 ? [inboxItem({ claimId: 501 }), inboxItem({ claimId: 502 })] : [inboxItem({ claimId: 502, claimNo: 'CLM-2026-0502' })]);
      }),
    );
    renderApp('/claims/501', { me: MANAGER });
    await userEvent.click(await screen.findByTestId('approve-btn'));
    await waitFor(() => expect(currentPath()).toBe('/claims/502'));
    expect(body).toEqual({ version: 3 });
    expect(await screen.findByText('Approved · opening next')).toBeInTheDocument();
    expect(await screen.findByTestId('claim-no')).toHaveTextContent('CLM-2026-0502');
  });

  it('TC-FE-D05 keyboard shortcut A approves; inbox zero returns to the inbox', async () => {
    server.use(
      http.get(api('/claims/501'), () => ok(claim())),
      http.post(api('/claims/501/approve'), () => ok(claim({ status: 'APPROVED' }))),
    );
    renderApp('/claims/501', { me: MANAGER });
    await screen.findByTestId('approve-btn');
    await userEvent.keyboard('a');
    await waitFor(() => expect(currentPath()).toBe('/inbox'));
  });

  it('TC-FE-D06 (TC-APR-06) reject needs a reason; the reason is sent with the version', async () => {
    let body: unknown;
    server.use(
      http.get(api('/claims/501'), () => ok(claim())),
      http.post(api('/claims/501/reject'), async ({ request }) => {
        body = await request.json();
        return ok(claim({ status: 'REJECTED' }));
      }),
    );
    renderApp('/claims/501', { me: MANAGER });
    await userEvent.click(await screen.findByTestId('reject-btn'));
    await userEvent.click(screen.getByTestId('reason-confirm'));
    expect(screen.getByTestId('reason-input-error')).toHaveTextContent(/reason is required/);
    await userEvent.type(screen.getByTestId('reason-input'), 'Personal expense');
    await userEvent.click(screen.getByTestId('reason-confirm'));
    await waitFor(() => expect(body).toEqual({ version: 3, reason: 'Personal expense' }));
  });

  it('TC-FE-D07 (EF-019) send back requires a comment', async () => {
    let body: unknown;
    server.use(
      http.get(api('/claims/501'), () => ok(claim())),
      http.post(api('/claims/501/send-back'), async ({ request }) => {
        body = await request.json();
        return ok(claim({ status: 'SENT_BACK' }));
      }),
    );
    renderApp('/claims/501', { me: MANAGER });
    await screen.findByTestId('send-back-btn');
    await userEvent.keyboard('s');
    expect(await screen.findByTestId('send-back-dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('reason-confirm'));
    expect(screen.getByTestId('reason-input-error')).toHaveTextContent(/comment is required/);
    await userEvent.type(screen.getByTestId('reason-input'), 'Attach the bill');
    await userEvent.click(screen.getByTestId('reason-confirm'));
    await waitFor(() => expect(body).toEqual({ version: 3, comment: 'Attach the bill' }));
  });

  it('TC-FE-D08 (EF-022, TC-SEC-07) double approval: a stale version shows the conflict banner', async () => {
    server.use(
      http.get(api('/claims/501'), () => ok(claim())),
      http.post(api('/claims/501/approve'), () => problem(409, 'stale')),
    );
    renderApp('/claims/501', { me: MANAGER });
    await userEvent.click(await screen.findByTestId('approve-btn'));
    expect(await screen.findByTestId('conflict-banner')).toHaveTextContent('This claim was updated by someone else. Refresh to see the latest state.');
  });

  it('TC-FE-D09 (EF-020) an active delegate acts "on behalf of" the manager', async () => {
    server.use(http.get(api('/claims/501'), () => ok(claim())));
    renderApp('/claims/501', { me: { ...EMPLOYEE_B, activeDelegations: [delegation()] } });
    expect(await screen.findByTestId('on-behalf-banner')).toHaveTextContent(MANAGER.name);
    expect(screen.getByTestId('approve-btn')).toBeInTheDocument();
  });

  it('TC-FE-D10 (R8) a viewer who is not the current approver is read-only with the reason', async () => {
    server.use(http.get(api('/claims/501'), () => ok(claim())));
    renderApp('/claims/501', { me: AUDITOR });
    expect(await screen.findByTestId('readonly-banner')).toHaveTextContent(/Waiting for manager/);
    expect(screen.queryByTestId('approve-btn')).not.toBeInTheDocument();
  });

  it('TC-FE-D11 audit trail shows "approved by X on behalf of Y"', async () => {
    server.use(
      http.get(api('/claims/501'), () =>
        ok(claim({ status: 'PENDING_AUDITOR', approvalSteps: [step({ status: 'APPROVED', actedByName: 'Rohit Verma', onBehalfOfName: 'Meera Iyer' }), step({ id: 2, seq: 2, level: 'AUDITOR', assigneeId: null })] })),
      ),
    );
    renderApp('/claims/501', { me: AUDITOR });
    expect(await screen.findByTestId('step-MANAGER-actor')).toHaveTextContent('Approved by Rohit Verma on behalf of Meera Iyer');
  });

  it('TC-FE-D12 (EF-010) duplicate flag links to a side-by-side comparison', async () => {
    server.use(
      http.get(api('/claims/501'), () =>
        ok(claim({ policyResults: [result({ ruleCode: 'DUPLICATE_RECEIPT_HASH', flag: 'DUPLICATE', matchClaimId: 88, matchClaimNo: 'CLM-2026-0088', matchLineId: 2 })] })),
      ),
      http.get(api('/claims/88'), () => ok(claim({ id: 88, claimNo: 'CLM-2026-0088', employeeName: 'Rohit Verma', lines: [line({ id: 2 })] }))),
    );
    renderApp('/claims/501', { me: MANAGER });
    await userEvent.click(await screen.findByTestId('duplicate-compare-1'));
    const modal = await screen.findByTestId('duplicate-compare');
    expect(modal).toHaveTextContent('Matching · CLM-2026-0088');
    expect(modal).toHaveTextContent('Rohit Verma');
  });

  it('TC-FE-D13 (BR-03) a policy-rejected claim can be copied to a new draft by its owner', async () => {
    const posted: string[] = [];
    server.use(
      http.get(api('/claims/501'), () => ok(claim({ status: 'POLICY_REJECTED', approvalSteps: [], lines: [line(), line({ id: 2 })] }))),
      http.post(api('/claims'), () => ok(claim({ id: 900, status: 'DRAFT', lines: [] }))),
      http.post(api('/claims/900/lines'), async ({ request }) => {
        posted.push(JSON.stringify(await request.json()));
        return ok(line());
      }),
      http.get(api('/claims/900'), () => ok(claim({ id: 900, status: 'DRAFT', approvalSteps: [], policyResults: [] }))),
    );
    renderApp('/claims/501', { me: EMPLOYEE });
    await userEvent.click(await screen.findByTestId('copy-to-draft'));
    await waitFor(() => expect(currentPath()).toBe('/claims/900/edit'));
    expect(posted).toHaveLength(2);
  });

  it('TC-FE-D14 mobile (360 px): sticky Approve and a "more" sheet with Send back / Reject', async () => {
    window.innerWidth = 360;
    server.use(http.get(api('/claims/501'), () => ok(claim())));
    renderApp('/claims/501', { me: MANAGER });
    expect(await screen.findByTestId('m-approve-btn')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('m-more-actions'));
    expect(await screen.findByTestId('m-send-back-btn')).toBeInTheDocument();
    expect(screen.getByTestId('m-reject-btn')).toBeInTheDocument();
  });
});
