import { expect, test } from '@playwright/test';
import { cast, isNarrow, loginApi, signInAs, signInUI, tid, uniquePng, weekday } from '../support/api';

test.describe('Employee journeys', () => {
  test('TC-E2E-01 employee creates a 3-line claim, saves a draft, submits; a small meal claim auto-approves', async ({ page, request }) => {
    const { employee } = await cast(request, 5);
    await signInUI(page, employee);

    // Draft with three lines
    await page.getByTestId('home-new-claim').click();
    await page.getByTestId('claim-title').fill('E2E client visit');
    await page.getByTestId('create-claim').click();
    await expect(page).toHaveURL(/\/claims\/\d+\/edit$/);
    const claimId = Number(/\/claims\/(\d+)\/edit/.exec(page.url())?.[1]);

    const addLine = async (category: string, amount: string, vendor: string, withReceipt: boolean, date: string) => {
      const sheetOrPanel = page.getByTestId('line-form');
      // On a new claim the mobile editor opens the line sheet by itself; give it a moment before deciding.
      const open = await sheetOrPanel.waitFor({ state: 'visible', timeout: 1500 }).then(() => true, () => false);
      if (!open) await page.getByTestId('add-line').click();
      await page.getByTestId('line-category').selectOption(category);
      await page.getByTestId('line-amount').fill(amount);
      await page.getByTestId('line-date').fill(date);
      await page.getByTestId('line-vendor').fill(vendor);
      await page.getByTestId('line-city').fill('Pune');
      if (withReceipt) {
        await page.getByTestId('line-receipt-input').setInputFiles({ name: 'r.png', mimeType: 'image/png', buffer: uniquePng() });
      }
      await page.getByTestId('line-save').click();
      await expect(page.getByTestId('line-form')).toBeHidden();
    };
    await addLine('MEAL', '400', 'Cafe A', false, weekday(1));
    await addLine('CAB', '300', 'Ola', false, weekday(2));
    await addLine('OTHER', '250', 'Stationery', false, weekday(3));
    await expect(page.getByText('₹950.00')).toBeVisible();

    await tid(page, 'save-draft').click();
    await expect(page).toHaveURL(/\/claims$/);
    await page.getByTestId(isNarrow(page, 768) ? `claim-card-${claimId}` : `claim-link-${claimId}`).click();
    await expect(page).toHaveURL(/\/edit$/);

    // All lines are under limits, ≤ 500 (no receipt needed), on weekdays → auto-approve (or SAMPLE audit).
    await expect(tid(page, 'submit-claim')).toBeEnabled();
    await tid(page, 'submit-claim').click();
    await expect(page).toHaveURL(/\/claims\/\d+$/);
    await expect(page.getByTestId(/status-chip-(APPROVED|PENDING_AUDITOR)/).first()).toBeVisible();
  });

  test('TC-E2E-02 a line above ₹500 without a receipt is auto-rejected with the reason shown', async ({ page, request }) => {
    const { employee } = await cast(request, 6);
    const api = await loginApi(request, employee);
    const claim = await api.createClaim('E2E parking', [{ category: 'OTHER', amount: '700', vendor: 'Parking', receipt: false }]);
    await signInAs(page, api);
    await page.goto(`/claims/${claim.id}/edit`);

    await expect(page.getByTestId('line-outcome-0')).toHaveAttribute('data-outcome', 'AUTO_REJECT');
    await expect(page.getByText(/Receipt required/).first()).toBeVisible();

    await tid(page, 'submit-claim').click();
    await expect(page.getByTestId('confirm-submit')).toContainText('policy-rejected');
    await page.getByTestId('confirm-submit-ok').click();
    await expect(page.getByTestId('status-chip-POLICY_REJECTED')).toBeVisible();
    await expect(page.getByTestId('policy-rejected-banner')).toBeVisible();
    await expect(page.getByTestId('copy-to-draft')).toBeVisible();
  });

  test('TC-E2E-10 employee A opening employee B’s claim URL sees "Claim not found"', async ({ page, request }) => {
    const { employee, otherEmployee } = await cast(request, 7);
    const b = await loginApi(request, otherEmployee);
    const claimB = await b.createClaim('E2E private', [{ category: 'MEAL', amount: '100' }]);

    const a = await loginApi(request, employee);
    await signInAs(page, a);
    await page.goto(`/claims/${claimB.id}`);
    await expect(page.getByTestId('not-found')).toContainText('Claim not found');

    // API also answers 404, not 403 (BR-27)
    const res = await request.get(`/api/claims/${claimB.id}`, { headers: { Authorization: `Bearer ${a.token}` } });
    expect(res.status()).toBe(404);
  });
});
