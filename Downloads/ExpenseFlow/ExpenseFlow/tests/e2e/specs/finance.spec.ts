import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { cast, isNarrow, loginApi, signInAs, uniqueAmount, uniquePng } from '../support/api';

test.describe('Auditor and finance head journeys', () => {
  test('TC-E2E-08 a duplicate receipt is flagged and shows under the auditor DUPLICATE filter', async ({ page, request }) => {
    const { employee, otherEmployee, manager, auditor } = await cast(request);
    const bytes = uniquePng();
    const amount = uniqueAmount(30_000);

    // Employee B claims a bill first; employee A then claims the very same file (renamed, other employee).
    const b = await loginApi(request, otherEmployee);
    await b.createAndSubmit('E2E original bill', [{ category: 'OTHER', amount: '1200.00', receipt: bytes }]);
    const a = await loginApi(request, employee);
    const dup = await a.createAndSubmit('E2E duplicate bill', [{ category: 'OTHER', amount, receipt: bytes }]);

    const detail = await a.json<{ policyResults: { flag?: string }[] }>('GET', `/claims/${dup.id}`);
    expect(detail.policyResults.some((r) => r.flag === 'DUPLICATE')).toBeTruthy();

    // Manager approves (> 25,000 adds the auditor step)
    await (await loginApi(request, manager)).approve(dup.id);

    const aud = await loginApi(request, auditor);
    await signInAs(page, aud);
    await page.goto(`/auditor?flag=DUPLICATE&min=${amount}&max=${amount}`);
    const row = isNarrow(page, 768) ? page.getByTestId(`queue-card-${dup.id}`) : page.getByTestId(`queue-row-${dup.id}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('flag-chip-DUPLICATE')).toBeVisible();

    await page.goto(`/claims/${dup.id}`);
    await expect(page.getByTestId(/duplicate-compare-/).first()).toBeVisible();
  });

  test('TC-E2E-09 auditor bulk-approves 5; finance head creates a payout, downloads the CSV and marks it paid', async ({ browser, request }) => {
    const { employee, manager, auditor, financeHead } = await cast(request);
    const emp = await loginApi(request, employee);
    const mgr = await loginApi(request, manager);
    const amount = uniqueAmount(26_000);

    const ids: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const c = await emp.createAndSubmit(`E2E bulk ${i}`, [{ category: 'OTHER', amount, receipt: true }]);
      await mgr.approve(c.id);
      ids.push(c.id);
    }

    // Auditor: isolate this run's claims by their unique amount, select all, bulk approve
    const audPage = await browser.newPage();
    await signInAs(audPage, await loginApi(request, auditor));
    await audPage.goto(`/auditor?min=${amount}&max=${amount}`);
    const narrow = isNarrow(audPage, 768);
    for (const id of ids) await audPage.getByTestId(narrow ? `m-select-${id}` : `select-${id}`).check();
    await expect(audPage.getByTestId('bulk-summary')).toContainText('5 selected');
    await audPage.getByTestId('bulk-approve').click();
    await audPage.getByTestId('bulk-confirm').click();
    await expect(audPage.getByTestId('bulk-result-summary')).toContainText('5 approved, 0 failed');
    for (const id of ids) await expect.poll(async () => (await emp.getClaim(id)).status).toBe('APPROVED');

    // Finance head: batch → preview → CSV → paid
    const fhPage = await browser.newPage();
    await signInAs(fhPage, await loginApi(request, financeHead));
    await fhPage.goto('/payouts');
    await fhPage.getByTestId('new-batch').click();
    for (const id of ids) await fhPage.getByTestId(`eligible-select-${id}`).check();
    await expect(fhPage.getByTestId('preview-claims')).toContainText('5');
    await expect(fhPage.getByTestId('preview-employees')).toContainText('1');
    await fhPage.getByTestId('create-batch').click();
    await expect(fhPage).toHaveURL(/\/payouts\/\d+$/);
    await expect(fhPage.getByTestId('mark-paid')).toBeDisabled();

    const download = fhPage.waitForEvent('download');
    await fhPage.getByTestId('export-csv').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^EXPF_\d{8}_\d+\.csv$/);
    const csv = await readFile((await file.path()) as string, 'utf8');
    const rows = csv.trim().split('\n');
    expect(rows[0]).toMatch(/^H,/);
    expect(rows.at(-1)).toMatch(/^T,CONTROL_TOTAL,/);
    expect(rows.find((r) => r.startsWith('H,') && !r.includes('BATCH_ID'))?.split(',')[4]).toBe(rows.at(-1)?.split(',')[2]);

    await fhPage.getByTestId('mark-paid').click();
    await fhPage.getByTestId('mark-paid-confirm').click();
    await expect(fhPage.getByTestId('payout-status-PAID')).toBeVisible();
    for (const id of ids) expect((await emp.getClaim(id)).status).toBe('PAID');
  });
});
