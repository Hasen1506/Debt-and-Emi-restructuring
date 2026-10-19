/** Every nav link lands on its page, mark-paid takes a typed amount, and a
 *  loan from a person has its own fields. */
import { test, expect, signIn, fillLoan, makeSetupChoices } from './fixtures';

test('links, a typed payment, advance tax and a loan from a person', async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, `qol-${Date.now()}@rightdue.app`);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel(/Take-home pay a month|What reaches your bank/i).first().fill('80000');
  await page.getByLabel(/Spending a month/i).fill('30000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^Home$/, balance: '2500000', rate: '8.5', emi: '21696', emiGoneOut: 'due' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await page.waitForURL((u) => u.pathname === '/');

  const paid = page.getByLabel(/Paid this month/i);
  await page.getByRole('button', { name: /Mark paid/i }).click();
  await expect(paid).toBeVisible();
  await expect(paid).toHaveValue(/[1-9]/);
  await paid.fill('1000');
  await page.getByRole('button', { name: 'SAVE' }).click();
  await expect(page.locator('#main')).toContainText(/short of the minimum/i);

  await page.goto('/tax/advance');
  await expect(page.getByRole('heading', { name: 'How the instalments are worked out' })).toBeVisible();
  await expect(page.getByText(/15% by 15 June/)).toBeVisible();
  await expect(page.getByText(/44AD/)).toBeVisible();
  await page.screenshot({ path: '/opt/cursor/artifacts/advance-tax.png', fullPage: true });

  await page.goto('/profile?step=loans');
  await page.getByLabel('Loan type').first().selectOption('people_loan');
  await expect(page.getByTestId('people-loan')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay whenever' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lump sum by a date' })).toBeVisible();
  await expect(page.getByLabel('Who you borrowed from')).toBeVisible();
  await expect(page.getByLabel('Interest rate (%)')).toHaveCount(0);
  await expect(page.getByLabel('Bank-required EMI')).toHaveCount(0);
  await expect(page.getByText('No interest, so extra payments go to a costlier loan first.')).toBeVisible();
  await page.getByTestId('cr-open').click();
  const bureaus = page.getByTestId('cr-bureaus');
  await expect(bureaus).toContainText('Experian');
  await expect(bureaus).toContainText('TransUnion CIBIL');
  await expect(bureaus).toContainText('Equifax');
  await expect(bureaus).toContainText('CRIF High Mark');
  await page.screenshot({ path: '/opt/cursor/artifacts/people-loan.png', fullPage: true });

  await page.goto('/');
  await expect(page.getByTestId('what-changed')).toBeVisible();
  await expect(page.getByTestId('calendar-one').first()).toBeVisible();
  await page.screenshot({ path: '/opt/cursor/artifacts/home-what-changed.png', fullPage: true });
  await page.goto('/activity');
  await expect(page.getByTestId('change-log')).toBeVisible();
  await page.screenshot({ path: '/opt/cursor/artifacts/change-log.png', fullPage: true });

  await page.goto('/account');
  await expect(page.getByTestId('family-share')).toBeVisible();
  await page.getByTestId('family-share-save').click();
  const shareUrl = page.getByTestId('family-share-url');
  await expect(shareUrl).toBeVisible();
  const shareHref = await shareUrl.innerText();
  await page.screenshot({ path: '/opt/cursor/artifacts/family-share.png', fullPage: true });
  await page.goto(shareHref);
  await expect(page.getByRole('heading', { name: 'A shared plan' })).toBeVisible();
  await expect(page.getByTestId('share-note')).toContainText('Read only');
  await expect(page.getByTestId('share-loans')).toBeVisible();
  await page.screenshot({ path: '/opt/cursor/artifacts/family-share-view.png', fullPage: true });

  const hrefs = new Set<string>();
  const take = async (sel: string) => {
    for (const a of await page.locator(sel).all()) {
      const href = await a.getAttribute('href');
      if (href && href.startsWith('/') && !href.startsWith('/login')) hrefs.add(href.split('#')[0]);
    }
  };
  await page.goto('/');
  await take('#rd-main-nav a[href]');
  await page.locator('#rd-more-button').click();
  await take('#rd-more-panel a[href]');
  expect(hrefs.has('/tax/advance')).toBe(true);
  expect(hrefs.has('/plan')).toBe(true);
  for (const href of hrefs) {
    await page.goto(href, { timeout: 25_000 });
    const pathOnly = href.split('?')[0];
    const body = pathOnly === '/' ? '\\/$' : `${pathOnly.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[?#]|$)`;
    await expect(page).toHaveURL(new RegExp(body));
    await expect(page.getByText('This page could not be found')).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/onboarding/);
  }
});
