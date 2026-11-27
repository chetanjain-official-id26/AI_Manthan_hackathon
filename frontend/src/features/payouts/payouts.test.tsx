import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { api, currentPath, ok, problem, renderApp } from '@/test/render';
import { FINANCE_HEAD, batch } from '@/test/fixtures';

const eligible = [
  { id: 1, claimNo: 'CLM-1', title: 'a', status: 'APPROVED', totalAmount: '10000.00', employeeId: 42, employeeName: 'Ananya Rao', version: 1 },
  { id: 2, claimNo: 'CLM-2', title: 'b', status: 'APPROVED', totalAmount: '8250.25', employeeId: 42, employeeName: 'Ananya Rao', version: 1 },
  { id: 3, claimNo: 'CLM-3', title: 'c', status: 'APPROVED', totalAmount: '30000.00', employeeId: 77, employeeName: 'Rohit Verma', version: 1 },
];

describe('S5 payouts (EF-026..028, EF-042)', () => {
  it('TC-FE-PY01 batch list shows status chips; empty state offers New batch', async () => {
    server.use(http.get(api('/payouts'), () => ok([batch({ status: 'EXPORTED' })])));
    const { unmount } = renderApp('/payouts', { me: FINANCE_HEAD });
    expect(await screen.findByTestId('batch-row-12')).toHaveTextContent('₹48,250.00');
    expect(screen.getByTestId('payout-status-EXPORTED')).toBeInTheDocument();
    unmount();
    server.use(http.get(api('/payouts'), () => ok([])));
    renderApp('/payouts', { me: FINANCE_HEAD });
    expect(await screen.findByTestId('batches-empty')).toBeInTheDocument();
  });

  it('TC-FE-PY02 create batch: live preview of claims, employees and exact total', async () => {
    let body: unknown;
    server.use(
      http.get(api('/payouts/eligible'), () => ok(eligible)),
      http.post(api('/payouts'), async ({ request }) => {
        body = await request.json();
        return ok(batch());
      }),
      http.get(api('/payouts/12'), () => ok(batch())),
    );
    renderApp('/payouts', { me: FINANCE_HEAD });
    await userEvent.click(await screen.findByTestId('new-batch'));
    await userEvent.click(await screen.findByTestId('eligible-select-1'));
    await userEvent.click(screen.getByTestId('eligible-select-2'));
    expect(screen.getByTestId('preview-claims')).toHaveTextContent('2');
    expect(screen.getByTestId('preview-employees')).toHaveTextContent('1');
    expect(screen.getByTestId('preview-total')).toHaveTextContent('₹18,250.25');
    await userEvent.click(screen.getByTestId('eligible-select-all'));
    expect(screen.getByTestId('preview-claims')).toHaveTextContent('3');
    expect(screen.getByTestId('preview-employees')).toHaveTextContent('2');
    await userEvent.click(screen.getByTestId('create-batch'));
    await waitFor(() => expect(currentPath()).toBe('/payouts/12'));
    expect(body).toEqual({ claimIds: [1, 2, 3] });
  });

  it('TC-FE-PY03 (R14, TC-PAY-04) a claim already in a batch → 409 message and refresh', async () => {
    server.use(http.get(api('/payouts/eligible'), () => ok(eligible)), http.post(api('/payouts'), () => problem(409, 'already batched')));
    renderApp('/payouts', { me: FINANCE_HEAD });
    await userEvent.click(await screen.findByTestId('new-batch'));
    await userEvent.click(await screen.findByTestId('eligible-select-1'));
    await userEvent.click(screen.getByTestId('create-batch'));
    expect(await screen.findByTestId('create-batch-error')).toHaveTextContent(/already in another batch/);
  });

  it('TC-FE-PY04 detail groups rows by employee with a control total', async () => {
    server.use(http.get(api('/payouts/12'), () => ok(batch())));
    renderApp('/payouts/12', { me: FINANCE_HEAD });
    expect(await screen.findByTestId('batch-group-42')).toHaveTextContent('₹18,250.00');
    expect(screen.getByTestId('batch-group-77')).toHaveTextContent('₹30,000.00');
    expect(screen.getByTestId('batch-total')).toHaveTextContent('₹48,250.00');
  });

  it('TC-FE-PY05 (EF-028) Mark paid is disabled until exported; export downloads the CSV', async () => {
    let exported = false;
    server.use(
      http.get(api('/payouts/12'), () => ok(batch({ status: exported ? 'EXPORTED' : 'CREATED', fileName: exported ? 'EXPF_20261127_12.csv' : null }))),
      http.get(api('/payouts/12/csv'), () => {
        exported = true;
        return new HttpResponse('H,12\n', { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="EXPF_20261127_12.csv"' } });
      }),
    );
    renderApp('/payouts/12', { me: FINANCE_HEAD });
    expect(await screen.findByTestId('mark-paid')).toBeDisabled();
    await userEvent.click(screen.getByTestId('export-csv'));
    expect(await screen.findByText('Downloaded EXPF_20261127_12.csv')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('mark-paid')).toBeEnabled());
    expect(screen.getByTestId('batch-file')).toHaveTextContent('EXPF_20261127_12.csv');
  });

  it('TC-FE-PY06 Mark paid needs confirmation and sends the version', async () => {
    let body: unknown;
    server.use(
      http.get(api('/payouts/12'), () => ok(batch({ status: 'EXPORTED', version: 6 }))),
      http.post(api('/payouts/12/mark-paid'), async ({ request }) => {
        body = await request.json();
        return ok(batch({ status: 'PAID' }));
      }),
    );
    renderApp('/payouts/12', { me: FINANCE_HEAD });
    await userEvent.click(await screen.findByTestId('mark-paid'));
    expect(await screen.findByTestId('mark-paid-dialog')).toHaveTextContent(/cannot be voided/);
    await userEvent.click(screen.getByTestId('mark-paid-confirm'));
    await waitFor(() => expect(body).toEqual({ version: 6 }));
  });

  it('TC-FE-PY07 (EF-042) void needs a reason; a paid batch cannot be voided', async () => {
    let body: unknown;
    server.use(
      http.get(api('/payouts/12'), () => ok(batch({ status: 'CREATED' }))),
      http.post(api('/payouts/12/void'), async ({ request }) => {
        body = await request.json();
        return ok(batch({ status: 'VOIDED' }));
      }),
    );
    const { unmount } = renderApp('/payouts/12', { me: FINANCE_HEAD });
    await userEvent.click(await screen.findByTestId('void-batch'));
    await userEvent.click(screen.getByTestId('void-confirm'));
    expect(screen.getByTestId('void-reason-error')).toHaveTextContent(/reason is required/);
    await userEvent.type(screen.getByTestId('void-reason'), 'Wrong IFSC');
    await userEvent.click(screen.getByTestId('void-confirm'));
    await waitFor(() => expect(body).toEqual({ reason: 'Wrong IFSC' }));
    unmount();

    server.use(http.get(api('/payouts/12'), () => ok(batch({ status: 'PAID' }))));
    renderApp('/payouts/12', { me: FINANCE_HEAD });
    await screen.findByTestId('batch-no');
    expect(screen.queryByTestId('void-batch')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mark-paid')).not.toBeInTheDocument();
  });
});
