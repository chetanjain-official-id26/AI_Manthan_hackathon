import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { server } from '@/test/server';
import { api, currentPath, ok, problem, renderApp } from '@/test/render';
import { AUDITOR, FINANCE_HEAD, page, queueItem } from '@/test/fixtures';

const rows = [
  queueItem({ claimId: 1, claimNo: 'CLM-1', totalAmount: '30000.00', version: 4 }),
  queueItem({ claimId: 2, claimNo: 'CLM-2', totalAmount: '30000.50', version: 7, sampleAudit: true }),
  queueItem({ claimId: 3, claimNo: 'CLM-3', employeeId: AUDITOR.id, employeeName: AUDITOR.name }),
];

describe('S4 auditor queue (EF-023..025)', () => {
  it('TC-FE-Q01 filters go to the API and the URL (bookmarkable)', async () => {
    const urls: URL[] = [];
    server.use(
      http.get(api('/auditor/queue'), ({ request }) => {
        urls.push(new URL(request.url));
        return ok(page(rows));
      }),
    );
    renderApp('/auditor', { me: AUDITOR });
    await screen.findByTestId('queue-table');
    expect(urls[0]?.searchParams.get('sort')).toBe('-age');
    await userEvent.selectOptions(screen.getByTestId('filter-flag'), 'DUPLICATE');
    await waitFor(() => expect(urls.at(-1)?.searchParams.get('flag')).toBe('DUPLICATE'));
    await userEvent.click(screen.getByTestId('filter-sample'));
    await waitFor(() => expect(urls.at(-1)?.searchParams.get('sample')).toBe('true'));
    expect(currentPath()).toContain('flag=DUPLICATE');
    await userEvent.click(screen.getByTestId('filter-reset'));
    await waitFor(() => expect(currentPath()).toBe('/auditor'));
  });

  it('TC-FE-Q02 a bookmarked URL restores the filters', async () => {
    const urls: URL[] = [];
    server.use(
      http.get(api('/auditor/queue'), ({ request }) => {
        urls.push(new URL(request.url));
        return ok(page(rows));
      }),
    );
    renderApp('/auditor?flag=DUPLICATE&min=25000&max=100000', { me: AUDITOR });
    expect(await screen.findByTestId('filter-flag')).toHaveValue('DUPLICATE');
    expect(urls[0]?.searchParams.get('min')).toBe('25000');
  });

  it('TC-FE-Q03 SAMPLE badge is shown; your own claim cannot be selected (R2)', async () => {
    server.use(http.get(api('/auditor/queue'), () => ok(page(rows))));
    renderApp('/auditor', { me: AUDITOR });
    expect(await screen.findByTestId('sample-badge-2')).toHaveTextContent('SAMPLE');
    expect(screen.getByTestId('select-3')).toBeDisabled();
    expect(screen.getByTestId('select-1')).toBeEnabled();
  });

  it('TC-FE-Q04 (EF-024) bulk bar shows count and exact total; results are per claim', async () => {
    let body: unknown;
    server.use(
      http.get(api('/auditor/queue'), () => ok(page(rows))),
      http.post(api('/auditor/bulk-approve'), async ({ request }) => {
        body = await request.json();
        return ok([
          { claimId: 1, result: 'APPROVED' },
          { claimId: 2, result: 'FAILED', error: 'Stale version' },
        ]);
      }),
    );
    renderApp('/auditor', { me: AUDITOR });
    await userEvent.click(await screen.findByTestId('select-1'));
    await userEvent.click(screen.getByTestId('select-2'));
    expect(screen.getByTestId('bulk-summary')).toHaveTextContent('2 selected · ₹60,000.50');
    await userEvent.click(screen.getByTestId('bulk-approve'));
    expect(await screen.findByTestId('bulk-list')).toHaveTextContent('CLM-1');
    await userEvent.click(screen.getByTestId('bulk-confirm'));
    expect(await screen.findByTestId('bulk-result-summary')).toHaveTextContent('1 approved, 1 failed');
    expect(screen.getByTestId('bulk-result-2')).toHaveTextContent('Stale version');
    expect(screen.getByTestId('bulk-result-1')).toHaveAttribute('data-ok', 'true');
    expect(body).toEqual({ items: [{ claimId: 1, version: 4 }, { claimId: 2, version: 7 }] });
    await userEvent.click(screen.getByTestId('bulk-done'));
    await waitFor(() => expect(screen.queryByTestId('bulk-bar')).not.toBeInTheDocument());
  });

  it('TC-FE-Q05 select-all selects only selectable rows on the page', async () => {
    server.use(http.get(api('/auditor/queue'), () => ok(page(rows))));
    renderApp('/auditor', { me: AUDITOR });
    await userEvent.click(await screen.findByTestId('select-all'));
    expect(screen.getByTestId('bulk-summary')).toHaveTextContent('2 selected');
  });

  it('TC-FE-Q06 finance head can review but not bulk approve', async () => {
    server.use(http.get(api('/auditor/queue'), () => ok(page(rows))));
    renderApp('/auditor', { me: FINANCE_HEAD });
    expect(await screen.findByTestId('select-1')).toBeDisabled();
    expect(screen.getByText(/Bulk approve is available to auditors/)).toBeInTheDocument();
  });

  it('TC-FE-Q07 (TC-SEC-15) a rejected sort/filter shows an error, and empty results a reset', async () => {
    server.use(http.get(api('/auditor/queue'), () => problem(400, 'Invalid sort')));
    const { unmount } = renderApp('/auditor', { me: AUDITOR });
    expect(await screen.findByTestId('error-banner')).toHaveTextContent('Invalid sort');
    unmount();
    server.use(http.get(api('/auditor/queue'), () => ok(page([]))));
    renderApp('/auditor', { me: AUDITOR });
    expect(await screen.findByTestId('queue-empty')).toHaveTextContent('No claims match these filters');
  });
});
