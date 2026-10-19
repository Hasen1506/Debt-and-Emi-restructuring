/**
 * Round 3 part D, UX walkthrough 2 #23 (two tabs): a Profile form open in
 * one tab no longer saves silently over what another tab saved. The other
 * tab shows a banner (localStorage stamp), and its save asks "Changed in
 * another tab — reload or overwrite?" (profileCookieKey() snapshot from when
 * the form opened). Overwrite saves this form; a form opened afterwards
 * does not ask.
 */
import { expect, fillLoan, landedOnOnboarding, makeSetupChoices, openProfileSection, signIn, test, continueToPlan } from './fixtures';

test('two tabs: banner in the other tab, reload-or-overwrite in the open form', async ({ page, context }) => {
  await signIn(page, 'r3d-two-tabs@rightdue.app');
  if (await landedOnOnboarding(page)) {
    await page.getByLabel(/Take-home pay a month/).fill('90000');
    await page.getByLabel(/Spending a month/).fill('40000');
    await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
    await fillLoan(page, 0, { kind: /^card$/i, balance: '85000', rate: '42' });
    await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
    await makeSetupChoices(page);
    await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
    await continueToPlan(page);
  }
  await page.goto('/profile');
  await openProfileSection(page, 'Income and spending');
  const tab2 = await context.newPage();
  await tab2.goto('/profile');
  await openProfileSection(tab2, 'Income and spending');
  // Tab 2 saves first.
  await tab2.getByLabel(/In-hand salary|Take-home/).first().fill('91000');
  await tab2.getByRole('button', { name: /SAVE CHANGES/ }).click();
  await expect(tab2.getByText('Saved. Home and Plan use the new numbers.')).toBeVisible();
  // Tab 1 is told (once the person is back on it), then its own save asks.
  await page.bringToFront();
  await expect(page.getByTestId('other-tab-saved')).toBeVisible();
  await page.getByLabel(/In-hand salary|Take-home/).first().fill('92000');
  await page.getByRole('button', { name: /SAVE CHANGES/ }).click();
  await expect(page.getByTestId('tab-conflict')).toContainText('Changed in another tab — reload or overwrite?');
  await expect(page.getByText('Saved. Home and Plan use the new numbers.')).toHaveCount(0);
  await page.getByTestId('tab-conflict-overwrite').click();
  await expect(page.getByText('Saved. Home and Plan use the new numbers.')).toBeVisible();
  await expect(page.getByText('₹92,000 a month').first()).toBeVisible();
  // A form opened after that save does not ask.
  await openProfileSection(page, 'Income and spending');
  await page.getByLabel(/In-hand salary|Take-home/).first().fill('90000');
  await page.getByRole('button', { name: /SAVE CHANGES/ }).click();
  await expect(page.getByText('Saved. Home and Plan use the new numbers.')).toBeVisible();
  await expect(page.getByTestId('tab-conflict')).toHaveCount(0);
});
