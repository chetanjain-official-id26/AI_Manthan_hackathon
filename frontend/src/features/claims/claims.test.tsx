import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { server } from '@/test/server';
import { api, currentPath, ok, problem, renderApp } from '@/test/render';
import { EMPLOYEE, MANAGER, claim, line, page, result, step } from '@/test/fixtures';

const summary = (over: object = {}) => ({
  id: 501,
  claimNo: 'CLM-2026-0501',
  title: 'Client visit Pune',
  status: 'PENDING_MANAGER',
  totalAmount: '18000.00',
  lineCount: 3,
  submittedAt: '2026-11-25T05:00:00Z',
  updatedAt: '2026-11-26T05:00:00Z',
  version: 1,
  ...over,
});

describe('S2a my claims', () => {
  it('TC-FE-M01 lists own claims newest-updated first with INR totals and status chips', async () => {
    server.use(
      http.get(api('/claims'), () =>
        ok(page([summary({ id: 1, claimNo: 'OLD', updatedAt: '2026-11-01T00:00:00Z' }), summary({ id: 2, claimNo: 'NEW', status: 'DRAFT', totalAmount: '120000' })])),
      ),
    );
    renderApp('/claims', { me: EMPLOYEE });
    const rows = await screen.findAllByTestId(/^claim-row-/);
    expect(rows[0]).toHaveTextContent('NEW');
    expect(rows[0]).toHaveTextContent('₹1,20,000.00');
    expect(within(rows[0] as HTMLElement).getByTestId('status-chip-DRAFT')).toHaveTextContent('Draft');
    expect(screen.getByTestId('claim-link-2')).toHaveAttribute('href', '/claims/2/edit');
    expect(screen.getByTestId('claim-link-1')).toHaveAttribute('href', '/claims/1');
  });

  it('TC-FE-M02 status filter is sent to the API and kept in the URL', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(api('/claims'), ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('status'));
        return ok(page([]));
      }),
    );
    renderApp('/claims', { me: EMPLOYEE });
    await userEvent.click(await screen.findByTestId('status-filter-SENT_BACK'));
    await waitFor(() => expect(seen).toContain('SENT_BACK'));
    expect(currentPath()).toBe('/claims?status=SENT_BACK');
    expect(await screen.findByTestId('claims-empty')).toHaveTextContent('No sent back claims');
  });

  it('TC-FE-M03 empty state offers "create your first claim"', async () => {
    renderApp('/claims', { me: EMPLOYEE });
    expect(await screen.findByTestId('empty-new-claim')).toHaveAttribute('href', '/claims/new');
    expect(screen.queryByTestId('claims-scope-others')).not.toBeInTheDocument();
  });

  it('TC-FE-M04 (BR-26) manager can switch to "My team" (mine=false, read-only links)', async () => {
    const mineParams: (string | null)[] = [];
    server.use(
      http.get(api('/claims'), ({ request }) => {
        const mine = new URL(request.url).searchParams.get('mine');
        mineParams.push(mine);
        return ok(page(mine ? [] : [summary({ id: 9, status: 'DRAFT', employeeName: 'Rohit Verma' })]));
      }),
    );
    renderApp('/claims', { me: MANAGER });
    await userEvent.click(await screen.findByTestId('claims-scope-others'));
    expect(await screen.findByTestId('claim-row-9')).toHaveTextContent('Rohit Verma');
    expect(mineParams).toContain(null);
    expect(screen.getByTestId('claim-link-9')).toHaveAttribute('href', '/claims/9');
  });

  it('TC-FE-M05 mobile (360 px) renders cards and a floating New claim button', async () => {
    window.innerWidth = 360;
    server.use(http.get(api('/claims'), () => ok(page([summary()]))));
    renderApp('/claims', { me: EMPLOYEE });
    expect(await screen.findByTestId('claim-card-501')).toBeInTheDocument();
    expect(screen.getByTestId('new-claim-fab')).toBeInTheDocument();
    expect(screen.queryByTestId('claims-table')).not.toBeInTheDocument();
  });
});

describe('S2b new / edit claim', () => {
  it('TC-FE-E01 (TC-CLM-01) creating a draft opens the editor', async () => {
    let title: unknown;
    server.use(
      http.post(api('/claims'), async ({ request }) => {
        title = await request.json();
        return ok(claim({ id: 777, status: 'DRAFT', lines: [], approvalSteps: [], policyResults: [] }));
      }),
      http.get(api('/claims/777'), () => ok(claim({ id: 777, status: 'DRAFT', lines: [], approvalSteps: [], policyResults: [] }))),
    );
    renderApp('/claims/new', { me: EMPLOYEE });
    await userEvent.click(await screen.findByTestId('create-claim'));
    expect(screen.getByTestId('claim-title-error')).toBeInTheDocument();
    await userEvent.type(screen.getByTestId('claim-title'), 'Client visit Pune');
    await userEvent.click(screen.getByTestId('create-claim'));
    await waitFor(() => expect(currentPath()).toBe('/claims/777/edit'));
    expect(title).toEqual({ title: 'Client visit Pune' });
  });

  it('TC-FE-E02 (EF-005) submit is disabled with 0 lines', async () => {
    server.use(http.get(api('/claims/501'), () => ok(claim({ status: 'DRAFT', lines: [], approvalSteps: [], policyResults: [] }))));
    renderApp('/claims/501/edit', { me: EMPLOYEE });
    expect(await screen.findByTestId('no-lines')).toBeInTheDocument();
    expect(screen.getByTestId('submit-claim')).toBeDisabled();
  });

  it('TC-FE-E03 (EF-004) live policy preview marks each line and explains the reason', async () => {
    server.use(
      http.get(api('/claims/501'), () =>
        ok(claim({ status: 'DRAFT', approvalSteps: [], policyResults: [], lines: [line({ id: 1 }), line({ id: 2, category: 'CAB', amount: '650', receipt: null, lineOutcome: null })] })),
      ),
      http.post(api('/claims/501/policy-preview'), () =>
        ok({
          claimOutcome: 'AUTO_REJECT',
          lines: [
            { lineId: 1, outcome: 'AUTO_APPROVE', results: [] },
            { lineId: 2, outcome: 'AUTO_REJECT', results: [result({ claimLineId: 2, ruleCode: 'RECEIPT_REQUIRED', outcome: 'AUTO_REJECT', flag: 'RECEIPT', limitAmount: '500', reason: 'RECEIPT_REQUIRED' })] },
          ],
        }),
      ),
    );
    renderApp('/claims/501/edit', { me: EMPLOYEE });
    await waitFor(() => expect(screen.getByTestId('line-outcome-1')).toHaveAttribute('data-outcome', 'AUTO_REJECT'), { timeout: 3000 });
    expect(screen.getByTestId('line-outcome-0')).toHaveAttribute('data-outcome', 'AUTO_APPROVE');
    expect(screen.getByTestId('line-policy-1')).toHaveTextContent('Receipt required above ₹500.00');
    expect(screen.getByTestId('claim-outcome-summary')).toHaveTextContent(/1 line will be rejected/);
  });

  it('TC-FE-E04 submitting a claim that will be rejected asks for confirmation, then submits with version', async () => {
    let submitted: unknown;
    server.use(
      http.get(api('/claims/501'), () => ok(claim({ status: 'DRAFT', version: 4, approvalSteps: [], policyResults: [], lines: [line({ receipt: null })] }))),
      http.post(api('/claims/501/policy-preview'), () => ok({ claimOutcome: 'AUTO_REJECT', lines: [{ lineId: 1, outcome: 'AUTO_REJECT', results: [] }] })),
      http.post(api('/claims/501/submit'), async ({ request }) => {
        submitted = await request.json();
        return ok(claim({ status: 'POLICY_REJECTED', version: 5 }));
      }),
    );
    renderApp('/claims/501/edit', { me: EMPLOYEE });
    await waitFor(() => expect(screen.getByTestId('submit-claim')).toBeEnabled(), { timeout: 3000 });
    await waitFor(() => expect(screen.getByTestId('line-outcome-0')).toHaveAttribute('data-outcome', 'AUTO_REJECT'));
    await userEvent.click(screen.getByTestId('submit-claim'));
    expect(await screen.findByTestId('confirm-submit')).toHaveTextContent(/policy-rejected/);
    await userEvent.click(screen.getByTestId('confirm-submit-ok'));
    await waitFor(() => expect(currentPath()).toBe('/claims/501'));
    expect(submitted).toEqual({ version: 4 });
  });

  it('TC-FE-E05 adding a line posts the line, uploads the receipt and refreshes', async () => {
    let posted: Record<string, unknown> | undefined;
    let uploaded = false;
    server.use(
      http.get(api('/claims/501'), () => ok(claim({ status: 'DRAFT', approvalSteps: [], policyResults: [], lines: [] }))),
      http.post(api('/claims/501/lines'), async ({ request }) => {
        posted = (await request.json()) as Record<string, unknown>;
        return ok(line({ id: 55 }));
      }),
      http.post(api('/claims/501/lines/55/receipt'), () => {
        uploaded = true;
        return ok({ receiptId: 1, sha256: 'x' });
      }),
    );
    const user = userEvent.setup();
    renderApp('/claims/501/edit', { me: EMPLOYEE });
    await user.type(await screen.findByTestId('line-amount'), '650');
    await user.selectOptions(screen.getByTestId('line-category'), 'CAB');
    await user.type(screen.getByTestId('line-vendor'), 'Ola');
    await user.type(screen.getByTestId('line-city'), 'Pune');
    await user.upload(screen.getByTestId('line-receipt-input'), new File(['img'], 'r.png', { type: 'image/png' }));
    await user.click(screen.getByTestId('line-save'));
    await waitFor(() => expect(uploaded).toBe(true));
    expect(posted).toMatchObject({ category: 'CAB', amount: '650', vendor: 'Ola', cityTier: 'TIER_1', nights: null });
  });

  it('TC-FE-E06 server 422 field errors appear next to the inputs', async () => {
    server.use(
      http.get(api('/claims/501'), () => ok(claim({ status: 'DRAFT', approvalSteps: [], policyResults: [], lines: [] }))),
      http.post(api('/claims/501/lines'), () => problem(422, 'Invalid', { errors: [{ field: 'vendor', message: 'Vendor not allowed' }] })),
    );
    const user = userEvent.setup();
    renderApp('/claims/501/edit', { me: EMPLOYEE });
    await user.type(await screen.findByTestId('line-amount'), '100');
    await user.type(screen.getByTestId('line-vendor'), 'X');
    await user.type(screen.getByTestId('line-city'), 'Pune');
    await user.click(screen.getByTestId('line-save'));
    expect(await screen.findByTestId('line-vendor-error')).toHaveTextContent('Vendor not allowed');
  });

  it('TC-FE-E07 (EF-019) a sent-back claim shows the approver comment banner', async () => {
    server.use(
      http.get(api('/claims/501'), () =>
        ok(claim({ status: 'SENT_BACK', approvalSteps: [step({ status: 'SENT_BACK', note: 'Please attach the hotel bill', actedByName: MANAGER.name })] })),
      ),
    );
    renderApp('/claims/501/edit', { me: EMPLOYEE });
    const banner = await screen.findByTestId('sent-back-banner');
    expect(banner).toHaveTextContent('Please attach the hotel bill');
    expect(banner).toHaveTextContent(MANAGER.name);
    expect(screen.getByTestId('submit-claim')).toHaveTextContent('Resubmit');
  });

  it('TC-FE-E08 (R4) a non-editable or someone else\'s claim opens read-only detail', async () => {
    server.use(http.get(api('/claims/501'), () => ok(claim({ status: 'PENDING_MANAGER' }))));
    renderApp('/claims/501/edit', { me: EMPLOYEE });
    await waitFor(() => expect(currentPath()).toBe('/claims/501'));
    expect(screen.queryByTestId('line-save')).not.toBeInTheDocument();
  });

  it('TC-FE-E09 (BR-28) stale version on submit shows the conflict banner', async () => {
    server.use(
      http.get(api('/claims/501'), () => ok(claim({ status: 'DRAFT', approvalSteps: [], policyResults: [] }))),
      http.post(api('/claims/501/submit'), () => problem(409, 'stale')),
    );
    renderApp('/claims/501/edit', { me: EMPLOYEE });
    await waitFor(() => expect(screen.getByTestId('submit-claim')).toBeEnabled(), { timeout: 3000 });
    await userEvent.click(screen.getByTestId('submit-claim'));
    expect(await screen.findByTestId('conflict-banner')).toHaveTextContent(/updated by someone else/);
  });
});
