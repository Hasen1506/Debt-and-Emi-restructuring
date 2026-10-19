/**
 * Opening Loans from ?step=loans before the account copy arrives must not
 * look like another tab, and must not save a blank form over the loans.
 */
import { expect, fillLoan, landedOnOnboarding, makeSetupChoices, signIn, test, continueToPlan } from './fixtures';

async function savedHomeLoan(page: import('@playwright/test').Page, email: string) {
  await signIn(page, email);
  if (!(await landedOnOnboarding(page))) return;
  await page.getByLabel(/Take-home pay a month/).fill('80000');
  await page.getByLabel(/Spending a month/).fill('30000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^home$/i, balance: '2500000', rate: '8.5', emi: '21696', emiGoneOut: 'due' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await continueToPlan(page);
}

test('slow account load: the loans form waits, then fills, and a save does not wipe the balance', async ({ page }) => {
  await savedHomeLoan(page, 'r3-slow-load@rightdue.app');
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const wiped: string[] = [];
  await page.route('**/api/session/user/state**', async (route) => {
    const req = route.request();
    if (req.method() === 'PATCH') {
      const body = req.postData() ?? '';
      if (body.includes('"outstanding":""') || body.includes('"outstanding":"0"')) wiped.push(body.slice(0, 200));
    }
    if (req.method() === 'GET') await gate;
    await route.continue();
  });
  await page.goto('/profile?step=loans');
  await expect(page.getByTestId('profile-form-loading')).toBeVisible();
  await expect(page.getByRole('button', { name: 'SAVE CHANGES' })).toHaveCount(0);
  await expect(page.getByTestId('tab-conflict')).toHaveCount(0);
  release();
  const balance = page.getByLabel('Outstanding balance');
  await expect(balance).toBeVisible();
  await expect(balance).toHaveValue(/25,00,000|2500000/);
  await expect(page.getByTestId('tab-conflict')).toHaveCount(0);
  await page.getByRole('button', { name: 'SAVE CHANGES' }).click();
  await expect(page.getByText('Saved. Home and Plan use the new numbers.')).toBeVisible();
  await expect(page.getByTestId('tab-conflict')).toHaveCount(0);
  expect(wiped).toEqual([]);
  await page.reload();
  await expect(page.getByLabel('Outstanding balance')).toHaveValue(/25,00,000|2500000/);
});

test('a real save in another tab still asks before this loans form overwrites it', async ({ page, context }) => {
  await savedHomeLoan(page, 'r3-real-conflict@rightdue.app');
  await page.goto('/profile?step=loans');
  const balance = page.getByLabel('Outstanding balance');
  await expect(balance).toHaveValue(/25,00,000|2500000/);
  const tab2 = await context.newPage();
  await tab2.goto('/profile?step=loans');
  await expect(tab2.getByLabel('Outstanding balance')).toHaveValue(/25,00,000|2500000/);
  await tab2.getByLabel('Nickname (optional)').fill('Other tab');
  await tab2.getByRole('button', { name: 'SAVE CHANGES' }).click();
  await expect(tab2.getByText('Saved. Home and Plan use the new numbers.')).toBeVisible();
  await page.getByLabel('Nickname (optional)').fill('This tab');
  await page.getByRole('button', { name: 'SAVE CHANGES' }).click();
  await expect(page.getByTestId('tab-conflict')).toContainText('Changed in another tab — reload or overwrite?');
  await expect(page.getByText('Saved. Home and Plan use the new numbers.')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Nickname (optional)')).toHaveValue('Other tab');
  await expect(page.getByLabel('Outstanding balance')).toHaveValue(/25,00,000|2500000/);
});

test('a blank loans form never replaces a saved balance', async ({ page }) => {
  await savedHomeLoan(page, 'r3-no-wipe@rightdue.app');
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const erased: string[] = [];
  await page.route('**/api/session/user/state**', async (route) => {
    const req = route.request();
    if (req.method() === 'PATCH') {
      const body = req.postData() ?? '';
      if (/"loans"\s*:\s*\[\s*\]/.test(body) || /"outstanding"\s*:\s*""/.test(body)) erased.push('empty');
    }
    if (req.method() === 'GET') await gate;
    await route.continue();
  });
  await page.goto('/profile?step=loans');
  await expect(page.getByTestId('profile-form-loading')).toBeVisible();
  await expect(page.getByRole('button', { name: 'SAVE CHANGES' })).toHaveCount(0);
  release();
  await expect(page.getByLabel('Outstanding balance')).toHaveValue(/25,00,000|2500000/);
  expect(erased).toEqual([]);
  await page.reload();
  await expect(page.getByLabel('Outstanding balance')).toHaveValue(/25,00,000|2500000/);
});
