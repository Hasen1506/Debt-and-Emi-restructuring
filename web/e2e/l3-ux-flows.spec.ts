/**
 * Sprint L3 (ux-flows): live-test findings #4, #5, #6, #11, #13, #19, #20 and
 * #1, end to end (rightdue-live-test.md). The persona is the live test's:
 * Chennai, a floating-rate home loan and an HDFC card at 42%.
 */
import { expect, fillLoan, signIn, test, makeSetupChoices, openProfileSection, continueToPlan } from './fixtures';

const EMAIL = 'golden-l3-ux@rightdue.app';

test('L3: nickname, city/state, business purpose, cost lines, spare cash date and next round', async ({ page }) => {
  await test.step('sign in and set up a home loan and a card', async () => {
    await signIn(page, EMAIL);
    await expect(page).toHaveURL(/\/onboarding$/);
    await page.getByLabel(/Take-home pay a month/).fill('120000');
    await page.getByLabel(/Spending a month/).fill('40000');
    await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
    await fillLoan(page, 0, { kind: /^home$/i, balance: '2500000', rate: '8.6', emi: '22000' });
    await fillLoan(page, 1, { kind: /^card$/i, balance: '150000', rate: '42' });
    await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
    await makeSetupChoices(page);
    await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
    await continueToPlan(page);
  });

  await test.step('#1: a signed-in visitor is never asked to start fresh', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Home' })).toBeAttached();
    await expect(page.getByTestId('guest-welcome-back')).toHaveCount(0);
  });

  await test.step('#5: state and city on Where you live', async () => {
    await page.goto('/profile');
    await openProfileSection(page, 'Where you live and tax');
    await page.getByLabel('State (optional)').selectOption('Tamil Nadu');
    await page.getByLabel('City (optional)').fill('Chennai');
    await page.getByRole('button', { name: /SAVE CHANGES/ }).click();
    await expect(page.getByText('Saved. Home and Plan use the new numbers.')).toBeVisible();
    await expect(page.getByText('Chennai, Tamil Nadu')).toBeVisible();
  });

  await test.step('#4 #11 #13: nickname, "for a business?", every cost line named', async () => {
    await page.goto('/profile');
    await openProfileSection(page, 'Loans');
    const purpose = page.getByTestId('business-purpose');
    await expect(purpose).toHaveCount(1); // the floating home loan, not the card
    await expect(purpose.getByText(/Not answered yet/)).toBeVisible();
    await purpose.getByRole('button', { name: 'Yes, for a business' }).click();
    await expect(purpose.getByRole('button', { name: 'Yes, for a business' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByPlaceholder('Not known').first()).toBeVisible();
    // The card's yearly cost, line by line: 42% + 9.11% compounding + 11.41% GST.
    await expect(page.getByText(/42\.00% ÷ 12 = 3\.500% a month/).first()).toBeVisible();
    await expect(page.getByTestId('cost-line-gst').first()).toContainText('GST on the interest (18%)');
    await expect(page.getByText('= 60.31%').first()).toBeVisible();
    await page.getByLabel('Nickname (optional)').nth(1).fill('TEST my card');
    await page.getByRole('button', { name: /SAVE CHANGES/ }).click();
    await expect(page.getByText('Saved. Home and Plan use the new numbers.')).toBeVisible();
    await expect(page.getByText(/^TEST my card \(/).first()).toBeVisible();
  });

  await test.step('#20 #19: spare cash dated to when it came in, then labelled as the next round', async () => {
    await page.goto('/tools/windfall');
    await page.getByLabel('Amount, after tax').fill('50000');
    await page.getByLabel('Date it came in').fill('2026-10-03');
    const log = page.getByRole('button', { name: /I DID THIS · LOG IT/ });
    await expect(page.getByText(/why this one/i).first()).toBeVisible();
    await log.click();
    await expect(page.getByRole('status').filter({ hasText: 'Logged:' })).toContainText('dated 2026-10-03');
    await expect(page.getByText("Got another ₹50,000? Here's where it would go next")).toBeVisible();
    await expect(page.getByTestId('wf-next-round')).toContainText('Already logged on 2026-10-03');
    await expect(page.getByText(/IF YOU PAY IT AGAIN · DEBT-FREE/)).toBeVisible();
    // A new amount starts over.
    await page.getByLabel('Amount, after tax').fill('20000');
    await expect(page.getByText('Where it goes', { exact: true })).toBeVisible();
  });

  await test.step('#20: Activity lists the payment on 3 Oct, not today (7 Oct)', async () => {
    await page.goto('/activity');
    await expect(page.getByText(/Spare cash: ₹[\d,]+ to TEST my card/).first()).toBeVisible();
    // The row's own controls name its date.
    await expect(page.getByRole('button', { name: /^Edit TEST my card.*, 2026-10-03$/ }).first()).toBeVisible();
    // R9-2 (WCAG 2.5.3): the spoken names start with the words on the buttons.
    await expect(page.getByRole('button', { name: /^Undo TEST my card.*, 2026-10-03$/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Change|Remove) / })).toHaveCount(0);
  });
});

test('#6: no Google button unless the server turns it on', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /send code/i })).toBeVisible();
  await expect(page.getByTestId('google-signin')).toHaveCount(0);
  const res = await page.request.get(`http://127.0.0.1:${process.env.E2E_API_PORT ?? 8100}/api/auth/google/config`);
  expect(await res.json()).toEqual({ enabled: false });
  expect((await page.request.get(`http://127.0.0.1:${process.env.E2E_API_PORT ?? 8100}/api/auth/google/start`, { maxRedirects: 0 })).status()).toBe(404);
});
