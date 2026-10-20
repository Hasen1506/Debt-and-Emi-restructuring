/**
 * Opening Loans from ?step=loans before the account copy arrives must not
 * look like another tab, and must not save a blank form over the loans.
 */
import type { Page } from '@playwright/test';
import { expect, fillLoan, landedOnOnboarding, makeSetupChoices, signIn, test, continueToPlan } from './fixtures';

async function savedHomeLoan(page: Page, email: string) {
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

/**
 * Hold GET /api/session/user/state until releaseUserState.
 *
 * page.route never sees this fetch on WebKit for Linux: the request is
 * served and the loans form is already filled, so the wait below cannot
 * fail the way it does in Chromium (a80-w05-retention.spec.ts). The hold
 * is inside the page, before its scripts, and the same checks run.
 */
async function holdUserState(page: Page, mark: 'body' | 'empty') {
  await page.addInitScript((mark) => {
    const w = window as unknown as { __releaseStateGets?: Array<() => void> };
    w.__releaseStateGets = [];
    const note = (line: string) => {
      const cur = JSON.parse(sessionStorage.getItem('e2e-state-notes') || '[]') as string[];
      cur.push(line);
      sessionStorage.setItem('e2e-state-notes', JSON.stringify(cur));
    };
    const real = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET')).toUpperCase();
      if (url.includes('/api/session/user/state')) {
        if (method === 'PATCH' || method === 'PUT') {
          const body = typeof init?.body === 'string' ? init.body : '';
          if (mark === 'body') {
            if (body.includes('"outstanding":""') || body.includes('"outstanding":"0"')) note(body.slice(0, 200));
          } else if (/"loans"\s*:\s*\[\s*\]/.test(body) || /"outstanding"\s*:\s*""/.test(body)) {
            note('empty');
          }
        }
        if (method === 'GET' && sessionStorage.getItem('e2e-hold-state') === '1') {
          await new Promise<void>((resolve) => { w.__releaseStateGets!.push(resolve); });
        }
      }
      return real(input, init);
    };
  }, mark);
  await page.evaluate(() => sessionStorage.setItem('e2e-hold-state', '1'));
}

async function releaseUserState(page: Page) {
  await page.evaluate(() => {
    sessionStorage.removeItem('e2e-hold-state');
    const w = window as unknown as { __releaseStateGets?: Array<() => void> };
    const waiting = w.__releaseStateGets ?? [];
    w.__releaseStateGets = [];
    waiting.forEach((fn) => fn());
  });
}

async function stateNotes(page: Page): Promise<string[]> {
  return page.evaluate(() => JSON.parse(sessionStorage.getItem('e2e-state-notes') || '[]') as string[]);
}

test('slow account load: the loans form waits, then fills, and a save does not wipe the balance', async ({ page }) => {
  await savedHomeLoan(page, 'r3-slow-load@rightdue.app');
  await holdUserState(page, 'body');
  await page.goto('/profile?step=loans');
  await expect(page.getByTestId('profile-form-loading')).toBeVisible();
  await expect(page.getByRole('button', { name: 'SAVE CHANGES' })).toHaveCount(0);
  await expect(page.getByTestId('tab-conflict')).toHaveCount(0);
  await releaseUserState(page);
  const balance = page.getByLabel('Outstanding balance');
  await expect(balance).toBeVisible();
  await expect(balance).toHaveValue(/25,00,000|2500000/);
  await expect(page.getByTestId('tab-conflict')).toHaveCount(0);
  await page.getByRole('button', { name: 'SAVE CHANGES' }).click();
  await expect(page.getByText('Saved. Home and Plan use the new numbers.')).toBeVisible();
  await expect(page.getByTestId('tab-conflict')).toHaveCount(0);
  expect(await stateNotes(page)).toEqual([]);
  // Save returns to the summary and drops ?step=. Wait for that navigation
  // before reloading, or the reload can reopen the editor from the old URL.
  await page.waitForURL((u) => u.pathname === '/profile' && !u.searchParams.has('step'));
  await page.reload();
  await expect(page.getByRole('row', { name: /Home loan/ })).toContainText('₹25,00,000');
  await page.getByRole('link', { name: 'Edit Loans' }).click();
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
  await holdUserState(page, 'empty');
  await page.goto('/profile?step=loans');
  await expect(page.getByTestId('profile-form-loading')).toBeVisible();
  await expect(page.getByRole('button', { name: 'SAVE CHANGES' })).toHaveCount(0);
  await releaseUserState(page);
  await expect(page.getByLabel('Outstanding balance')).toHaveValue(/25,00,000|2500000/);
  expect(await stateNotes(page)).toEqual([]);
  await page.reload();
  await expect(page.getByLabel('Outstanding balance')).toHaveValue(/25,00,000|2500000/);
});
