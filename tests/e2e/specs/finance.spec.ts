import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { cast, employeesWithManagers, isNarrow, loginApi, signInAs, uniqueAmount, uniquePng } from '../support/api';

test.describe('Auditor and finance head journeys', () => {
  test('TC-E2E-08 a duplicate receipt is flagged and shows under the auditor DUPLICATE filter', async ({ page, request }) => {
    const { employee, otherEmployee, manager, auditor } = await cast(request, 8);
    const bytes = uniquePng();
    const amount = uniqueAmount(30_000);

    // Employee B claims a bill first; employee A then claims the very same file (renamed, other employee).
    const b = await loginApi(request, otherEmployee);
    await b.createAndSubmit('E2E original bill', [{ category: 'OTHER', amount: '1200.00', receipt: bytes }]);
    const a = await loginApi(request, employee);
    const dup = await a.createAndSubmit('E2E duplicate bill', [{ category: 'OTHER', amount, receipt: bytes }]);

    // Backend detail: policy results live on each line.
    const detail = await a.json<{ lines: { policyResults: { flag?: string }[] }[] }>('GET', `/claims/${dup.id}`);
    expect(detail.lines.some((l) => l.policyResults.some((r) => r.flag === 'DUPLICATE'))).toBeTruthy();

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
    test.slow(); // five employees file and get approved via the API before the UI part starts
    const { auditor, financeHead } = await cast(request, 9);
    // The claims belong to five employees, so read their status as the finance head (sees all claims).
    const fh = await loginApi(request, financeHead);
    const amount = uniqueAmount(26_000);

    // Five different employees: five 26k claims from one person within a week would be a split suspect (BR-10a)
    // and pick up a finance head step.
    const ids: number[] = [];
    const people = await employeesWithManagers(request, 5, 9);
    for (const [i, p] of people.entries()) {
      const owner = await loginApi(request, p.employee);
      const c = await owner.createAndSubmit(`E2E bulk ${i}`, [{ category: 'OTHER', amount, receipt: true }]);
      await (await loginApi(request, p.manager)).approve(c.id);
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
    for (const id of ids) await expect.poll(async () => (await fh.getClaim(id)).status).toBe('APPROVED');

    // Finance head: batch → preview → CSV → paid
    const fhPage = await browser.newPage();
    await signInAs(fhPage, fh);
    await fhPage.goto('/payouts');
    await fhPage.getByTestId('new-batch').click();
    for (const id of ids) await fhPage.getByTestId(isNarrow(fhPage, 768) ? `m-eligible-select-${id}` : `eligible-select-${id}`).check();
    await expect(fhPage.getByTestId('preview-claims')).toContainText('5');
    await expect(fhPage.getByTestId('preview-employees')).toContainText('5');
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
    for (const id of ids) expect((await fh.getClaim(id)).status).toBe('PAID');
  });
});
