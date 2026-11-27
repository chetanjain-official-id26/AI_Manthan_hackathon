import { expect, test, type Page } from '@playwright/test';
import { cast, loginApi, signInAs, tid, type Api, type User } from '../support/api';

/** One OTHER line (no category limit) with a receipt: policy AUTO_APPROVE, routed only because total > auto-approve cap. */
const routed = (amount: string) => [{ category: 'OTHER' as const, amount, receipt: true }];

async function approveInUI(page: Page, api: Api, claimId: number) {
  await signInAs(page, api);
  await page.goto(`/claims/${claimId}`, { waitUntil: 'domcontentloaded' });
  await tid(page, 'approve-btn').click();
  await expect(page.getByText(/^Approved · /)).toBeVisible();
}

async function statusOf(api: Api, id: number) {
  return (await api.getClaim(id)).status;
}

test.describe('Approval chain thresholds (BR-06..BR-10)', () => {
  test('TC-E2E-03 an 18,000 claim needs the manager only → Approved', async ({ page, request }) => {
    const { employee, manager } = await cast(request);
    const emp = await loginApi(request, employee);
    const claim = await emp.createAndSubmit('E2E 18k', routed('18000.00'));
    expect(claim.status).toBe('PENDING_MANAGER');

    const mgr = await loginApi(request, manager);
    await signInAs(page, mgr);
    await page.goto('/inbox');
    await expect(page.getByText(claim.claimNo).first()).toBeVisible();
    await page.goto(`/claims/${claim.id}`);
    await expect(page.getByTestId('receipt-viewer-image')).toBeVisible();
    await tid(page, 'approve-btn').click();
    await expect.poll(() => statusOf(emp, claim.id)).toBe('APPROVED');
  });

  test('TC-E2E-04 a 60,000 claim goes manager → auditor → Approved', async ({ browser, request }) => {
    const { employee, manager, auditor } = await cast(request);
    const emp = await loginApi(request, employee);
    const claim = await emp.createAndSubmit('E2E 60k', routed('60000.00'));

    const mgrPage = await browser.newPage();
    await approveInUI(mgrPage, await loginApi(request, manager), claim.id);
    await expect.poll(() => statusOf(emp, claim.id)).toBe('PENDING_AUDITOR');

    const audPage = await browser.newPage();
    await approveInUI(audPage, await loginApi(request, auditor), claim.id);
    await expect.poll(() => statusOf(emp, claim.id)).toBe('APPROVED');
  });

  test('TC-E2E-05 a 1,20,000 claim goes manager → auditor → finance head → Approved', async ({ browser, request }) => {
    const { employee, manager, auditor, financeHead } = await cast(request);
    const emp = await loginApi(request, employee);
    const claim = await emp.createAndSubmit('E2E 1.2L', routed('120000.00'));

    await approveInUI(await browser.newPage(), await loginApi(request, manager), claim.id);
    await approveInUI(await browser.newPage(), await loginApi(request, auditor), claim.id);
    await expect.poll(() => statusOf(emp, claim.id)).toBe('PENDING_FINANCE_HEAD');

    const fhPage = await browser.newPage();
    await signInAs(fhPage, await loginApi(request, financeHead));
    await fhPage.goto(`/claims/${claim.id}`);
    await fhPage.getByTestId('detail-tab-steps').click();
    await expect(fhPage.getByTestId('step-AUDITOR')).toHaveAttribute('data-status', 'APPROVED');
    await tid(fhPage, 'approve-btn').click();
    await expect.poll(() => statusOf(emp, claim.id)).toBe('APPROVED');
  });

  test('TC-E2E-06 manager sends back; employee edits and resubmits; the chain restarts', async ({ browser, request }) => {
    const { employee, manager } = await cast(request);
    const emp = await loginApi(request, employee);
    const claim = await emp.createAndSubmit('E2E send back', routed('18000.00'));

    const mgrPage = await browser.newPage();
    await signInAs(mgrPage, await loginApi(request, manager));
    await mgrPage.goto(`/claims/${claim.id}`);
    if ((mgrPage.viewportSize()?.width ?? 1366) < 1024) {
      await mgrPage.getByTestId('m-more-actions').click();
      await mgrPage.getByTestId('m-send-back-btn').click();
    } else {
      await mgrPage.getByTestId('send-back-btn').click();
    }
    await mgrPage.getByTestId('reason-input').fill('Please split the hotel and meals');
    await mgrPage.getByTestId('reason-confirm').click();
    await expect.poll(() => statusOf(emp, claim.id)).toBe('SENT_BACK');

    const empPage = await browser.newPage();
    await signInAs(empPage, emp);
    await empPage.goto(`/claims/${claim.id}/edit`);
    await expect(empPage.getByTestId('sent-back-banner')).toContainText('Please split the hotel and meals');
    await empPage.getByTestId('claim-title').fill('E2E send back (fixed)');
    await tid(empPage, 'submit-claim').click();
    await expect(empPage).toHaveURL(new RegExp(`/claims/${claim.id}$`));
    await expect.poll(() => statusOf(emp, claim.id)).toBe('PENDING_MANAGER');
  });

  test('TC-E2E-07 manager on leave delegates; delegate approves; audit shows "on behalf of"', async ({ browser, request }) => {
    const { employee, manager, colleague } = await cast(request);
    const emp = await loginApi(request, employee);
    const mgr = await loginApi(request, manager);
    const claim = await emp.createAndSubmit('E2E delegated', routed('18000.00'));

    // Manager creates the delegation in the UI
    const mgrPage = await browser.newPage();
    await signInAs(mgrPage, mgr);
    await mgrPage.goto('/settings/delegation');
    await mgrPage.getByTestId('delegate-search').fill(colleague.name);
    await mgrPage.getByTestId('delegate-select').selectOption(String(colleague.id));
    await mgrPage.getByTestId('delegation-reason').fill('E2E annual leave');
    await mgrPage.getByTestId('delegation-submit').click();
    await expect(mgrPage.getByText('Delegation created')).toBeVisible();

    try {
      const del = await loginApi(request, colleague as User);
      const delPage = await browser.newPage();
      await signInAs(delPage, del);
      await delPage.goto(`/claims/${claim.id}`);
      await expect(delPage.getByTestId('on-behalf-banner')).toContainText(manager.name);
      await tid(delPage, 'approve-btn').click();
      await expect.poll(() => statusOf(emp, claim.id)).toBe('APPROVED');

      await delPage.goto(`/claims/${claim.id}`);
      await delPage.getByTestId('detail-tab-steps').click();
      await expect(delPage.getByTestId('step-MANAGER-actor')).toContainText(`by ${colleague.name} on behalf of ${manager.name}`);
    } finally {
      const list = await mgr.json<{ id: number; delegateId: number; revoked: boolean }[]>('GET', '/delegations');
      for (const d of list.filter((x) => x.delegateId === colleague.id && !x.revoked)) await mgr.json('DELETE', `/delegations/${d.id}`);
    }
  });
});
