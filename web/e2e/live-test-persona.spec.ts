/**
 * Sprint L5: the live test's persona, end to end (rightdue-live-test.md).
 * Chennai, ₹1,20,000 take-home, three loans: an HDFC card ₹1,50,000 at 42%,
 * a fixed personal loan ₹4,00,000 at 14% and a floating home loan
 * ₹25,00,000 at 8.6%. Signed in (CI builds the signed-in app): the guest
 * half of the live test is in live-test-findings.spec.ts under L1.
 *
 * EMIs are the standard formula, rounded up: ₹4L at 14% over 48 months =
 * ₹10,931; ₹25L at 8.6% over 240 months = ₹21,855.
 */
import { expect, test } from './fixtures';
import { setUpPersona } from './persona';

test('Persona: Chennai, ₹1.2L take-home, 3 loans: set up, saved, plan dated, survives reload', async ({ page }) => {
  await test.step('set up the three loans', async () => setUpPersona(page));

  await test.step('the plan has a debt-free date (surplus ₹47,214 covers the minimums)', async () => {
    await expect(page.getByRole('heading', { name: /^MONTH BY MONTH/ })).toBeVisible();
    await expect(page.getByText(/NO DATE YET/i)).toHaveCount(0);
  });

  await test.step('#3 (signed in): the loans survive a reload of Profile', async () => {
    await page.goto('/profile');
    await page.reload();
    const table = page.locator('table').filter({ hasText: 'OWED' });
    await expect(table.getByRole('row', { name: /^Credit card/ })).toBeVisible();
    await expect(table.getByRole('row', { name: /^Personal loan/ })).toBeVisible();
    await expect(table.getByRole('row', { name: /^Home loan/ })).toBeVisible();
  });

  await test.step('#22: Home shows what to pay with zero clicks; one click marks it paid, with Undo', async () => {
    await page.goto('/');
    const mark = page.getByRole('button', { name: /^Mark paid: Credit card/ }).first();
    await expect(mark).toBeVisible();
    await mark.click();
    await page.getByRole('button', { name: 'SAVE' }).click();
    await expect(page.getByRole('button', { name: /^Undo: Credit card not paid/ }).first()).toBeVisible();
  });

  await test.step('#21: Activity lists that payment as an editable, undoable row', async () => {
    await page.goto('/activity');
    await expect(page.getByText(/Credit card/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Edit Credit card/ }).first()).toBeVisible();
  });
});
