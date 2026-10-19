/**
 * Can't-pay answers, hardship checkboxes and a hand-edited letter stay
 * after a refresh and a new visit. The account holds them; this browser
 * keeps a copy. RESET TO DRAFT and START OVER still do only what they say.
 */
import { expect, fillLoan, landedOnOnboarding, makeSetupChoices, signIn, test, continueToPlan } from './fixtures';

async function indiaReady(page: import('@playwright/test').Page, email: string) {
  await signIn(page, email);
  if (await landedOnOnboarding(page)) {
    await page.getByLabel(/Take-home pay a month/).fill('90000');
    await page.getByLabel(/Spending a month/).fill('40000');
    await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
    await fillLoan(page, 0, { kind: /^home$/i, balance: '2500000', rate: '8.5', emi: '21696', emiGoneOut: 'due' });
    await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
    await makeSetupChoices(page);
    await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
    await continueToPlan(page);
  }
  await page.goto('/cant-pay');
  await expect(page.getByLabel('Reason (short and true)')).toBeVisible();
}

test('India: a refresh keeps the reason, a checkbox, the cost and a hand-edited letter', async ({ page }) => {
  await indiaReady(page, 'r3-cant-refresh@rightdue.app');
  await page.getByLabel('Reason (short and true)').fill('Hours were cut');
  await page.getByLabel('Reason (short and true)').blur();
  const lower = page.getByTestId('ask-lower_emi');
  if (!(await lower.isChecked())) await lower.check();
  await page.getByLabel('Months unpaid').fill('2');
  await page.getByLabel('Months unpaid').blur();
  const letter = page.getByTestId('cp-letter-text');
  const drafted = await letter.inputValue();
  await letter.fill(`${drafted}\nQA extra line.`);
  await letter.blur();
  await page.reload();
  await expect(page.getByLabel('Reason (short and true)')).toHaveValue('Hours were cut');
  await expect(page.getByTestId('ask-lower_emi')).toBeChecked();
  await expect(page.getByLabel('Months unpaid')).toHaveValue('2');
  await expect(page.getByTestId('cp-letter-text')).toHaveValue(/QA extra line\./);
});

test('India: editing the reason and refreshing keeps the new reason and the hand-edited letter', async ({ page }) => {
  await indiaReady(page, 'r3-cant-edit@rightdue.app');
  await page.getByLabel('Reason (short and true)').fill('Hours were cut');
  await page.getByLabel('Reason (short and true)').blur();
  const letter = page.getByTestId('cp-letter-text');
  await letter.fill(`${await letter.inputValue()}\nQA extra line.`);
  await letter.blur();
  await page.reload();
  await page.getByLabel('Reason (short and true)').fill('Hours were cut further');
  await page.getByLabel('Reason (short and true)').blur();
  await page.reload();
  await expect(page.getByLabel('Reason (short and true)')).toHaveValue('Hours were cut further');
  await expect(page.getByTestId('cp-letter-text')).toHaveValue(/QA extra line\./);
});

test('India: a new visit restores the letter from the account after this browser’s copy is cleared', async ({ page }) => {
  await indiaReady(page, 'r3-cant-account@rightdue.app');
  await page.getByLabel('Reason (short and true)').fill('Hours were cut');
  await page.getByLabel('Reason (short and true)').blur();
  const letter = page.getByTestId('cp-letter-text');
  await letter.fill(`${await letter.inputValue()}\nQA extra line.`);
  const saved = page.waitForResponse((r) =>
    r.request().method() === 'PATCH' && r.url().includes('/user/state') && (r.request().postData() ?? '').includes('QA extra line'));
  await letter.blur();
  await saved;
  await page.evaluate(() => localStorage.removeItem('rightdue_cant_pay'));
  await page.reload();
  await expect(page.getByLabel('Reason (short and true)')).toHaveValue('Hours were cut', { timeout: 15000 });
  await expect(page.getByTestId('cp-letter-text')).toHaveValue(/QA extra line\./);
});

test('India: RESET TO DRAFT drops the hand edit and START OVER clears the page', async ({ page }) => {
  await indiaReady(page, 'r3-cant-reset@rightdue.app');
  const reason = page.getByLabel('Reason (short and true)');
  await reason.fill('Hours were cut');
  await reason.blur();
  const letter = page.getByTestId('cp-letter-text');
  await letter.fill('My own words, not the draft.');
  await letter.blur();
  await page.getByRole('button', { name: 'RESET TO DRAFT' }).click();
  await expect(letter).toHaveValue(/Hours were cut/);
  await expect(letter).not.toHaveValue(/My own words/);
  await page.reload();
  await expect(page.getByLabel('Reason (short and true)')).toHaveValue('Hours were cut');
  await expect(page.getByTestId('cp-letter-text')).not.toHaveValue(/My own words/);
  await page.getByRole('button', { name: 'START OVER' }).click();
  await expect(page.getByLabel('Reason (short and true)')).toHaveValue('');
  await page.reload();
  await expect(page.getByLabel('Reason (short and true)')).toHaveValue('');
  await expect(page.getByTestId('cp-letter-text')).not.toHaveValue(/Hours were cut/);
});

test('US hardship letter: refresh and a second edit keep the hand-typed letter', async ({ page }) => {
  await signIn(page, 'r3-cant-us@rightdue.app');
  await page.goto('/cant-pay/us-letters');
  await expect(page.getByTestId('usl-hardship')).toBeVisible();
  // The server HTML is on screen before this effect. A fill in that gap
  // changes the box and not the saved letter.
  await expect(page.getByTestId('cp-letter')).toHaveAttribute('data-hydrated', '1');
  await page.getByLabel('Reason (short and true)').fill('Hours were cut');
  await page.getByLabel('Reason (short and true)').blur();
  const pause = page.getByTestId('ask-pause');
  if (await pause.isChecked()) await pause.uncheck();
  const letter = page.getByTestId('cp-letter-text');
  await letter.fill(`${await letter.inputValue()}\nQA extra line.`);
  await letter.blur();
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('rightdue_cant_pay') ?? '')).toContain('Hours were cut');
  await page.reload();
  await expect(page.getByLabel('Reason (short and true)')).toHaveValue('Hours were cut');
  await expect(page.getByTestId('ask-pause')).not.toBeChecked();
  await expect(page.getByTestId('cp-letter-text')).toHaveValue(/QA extra line\./);
  await page.getByLabel('Reason (short and true)').fill('Hours were cut further');
  await page.getByLabel('Reason (short and true)').blur();
  await page.reload();
  await expect(page.getByLabel('Reason (short and true)')).toHaveValue('Hours were cut further');
  await expect(page.getByTestId('cp-letter-text')).toHaveValue(/QA extra line\./);
});
