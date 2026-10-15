/**
 * Round 2 (15 Oct 2026): the US letters page, its entry points, and the
 * "Draft — pending legal review" markers on letters and on the privacy /
 * terms changes.
 */
import type { Page } from '@playwright/test';
import { expect, fillLoan, makeSetupChoices, signIn, test } from './fixtures';

const AXE = require.resolve('axe-core/axe.min.js');

/** axe's critical WCAG 2.1 A/AA violations (same check as cant-pay.spec.ts; a spec can't import another spec). */
async function axeCritical(page: Page): Promise<string[]> {
  await page.addScriptTag({ path: AXE });
  const v = (await page.evaluate(async () => {
    const r = await (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: unknown[] }> } }).axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return r.violations;
  })) as Array<{ id: string; impact: string | null; nodes: { target: string[] }[] }>;
  return v.filter((x) => x.impact === 'critical').map((x) => `${x.id}: ${x.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

const MARKER = 'Draft — pending legal review';

test('US letters, signed out: three letters, FCBA from the API filled in the browser, deadlines, RESPA; no critical axe issues', async ({ page }) => {
  await page.goto('/cant-pay/us-letters');
  await expect(page).toHaveURL(/\/cant-pay\/us-letters$/);          // public: no sign-in wall
  await expect(page).toHaveTitle(/US letters · RightDue/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('US LETTERS');
  const kinds = page.getByRole('radiogroup', { name: 'Which letter' }).getByRole('radio');
  await expect(kinds).toHaveCount(3);

  // Hardship (default): the shared letter, US words, with its draft marker and the collector rules.
  await expect(page.getByTestId('usl-hardship')).toBeVisible();
  await expect(page.getByTestId('draft-legal-letter-hardship')).toHaveText(MARKER);
  await expect(page.getByTestId('cp-letter-text')).toHaveValue(/hardship/i);
  await expect(page.getByTestId('usl-rights')).toContainText('8 a.m.');

  // FCBA billing dispute: letter text comes from /api/complaints/us.
  const fcbaCall = page.waitForResponse((r) => r.url().includes('/api/complaints/us') && r.request().method() === 'POST');
  await page.getByTestId('usl-kind-fcba_billing_error').click();
  expect((await fcbaCall).status()).toBe(200);
  await expect(page).toHaveURL(/\?kind=fcba_billing_error$/);
  await expect(page.getByTestId('draft-legal-letter-us')).toHaveText(MARKER);
  const text = page.getByTestId('usl-text');
  await expect(text).toHaveValue(/12 CFR 1026\.13/);
  await expect(text).toHaveValue(/\[Full name\]/);
  await expect(page.getByTestId('usl-missing')).toContainText('your full name');
  await page.getByLabel('Your full name').fill('Jordan Lee');
  await page.getByLabel('Card issuer').fill('Chase');
  await page.getByLabel('Disputed amount (US$)').fill('$84.20');
  await expect(text).toHaveValue(/Jordan Lee/);
  await expect(text).toHaveValue(/^Chase/);
  await expect(text).toHaveValue(/\$84\.20/);
  await expect(text).not.toHaveValue(/\[Full name\]/);
  await expect(page.getByTestId('usl-how-to-send')).toContainText('billing-error');
  await expect(page.getByTestId('usl-draft-notice')).toContainText('Draft');

  // Deadlines once it has gone: statement date + sent date.
  await page.getByTestId('usl-statement-on').fill('2026-09-25');
  await page.getByTestId('usl-sent-on').fill('2026-10-02');
  await expect(page.getByTestId('usl-timeline').locator('li').first()).toBeVisible();
  await expect(page.getByTestId('usl-if-no-answer')).toContainText('consumerfinance.gov/complaint');

  // RESPA notice of error.
  await page.getByTestId('usl-kind-respa_notice_of_error').click();
  await expect(text).toHaveValue(/12 CFR 1024\.35/);
  await page.getByLabel('Mortgage servicer').fill('Acme Servicing');
  await expect(text).toHaveValue(/^Acme Servicing/);
  await expect(page.getByTestId('usl-how-to-send')).toContainText('1024.35(c)');

  expect(await axeCritical(page)).toEqual([]);
});

test('US letters at 390 px: nothing overflows sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/cant-pay/us-letters?kind=fcba_billing_error');
  await expect(page.getByTestId('usl-text')).toHaveValue(/1026\.13/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('Can’t pay (public): USA links to the US letters; India letters carry the draft marker', async ({ page }) => {
  await page.goto('/cant-pay');
  await expect(page.getByTestId('cp-public')).toBeVisible();
  await page.getByTestId('cp-country-in').click();
  await expect(page.getByTestId('draft-legal-letter-hardship')).toHaveText(MARKER);
  await expect(page.getByTestId('draft-legal-letter-recovery-agent')).toHaveText(MARKER);
  await expect(page.getByTestId('cp-us-letters-link')).toHaveCount(0);
  await page.getByTestId('cp-country-us').click();
  const link = page.getByTestId('cp-us-letters-link').getByRole('link', { name: /US LETTERS/ });
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL('**/cant-pay/us-letters');
  await expect(page.getByTestId('us-letters')).toBeVisible();
});

test('privacy notice and terms: draft markers on the changes, role addresses only', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByTestId('privacy-r2-additions')).toContainText('Payday email');
  await expect(page.getByTestId('privacy-r2-additions')).toContainText('Usage counts');
  await expect(page.getByTestId('draft-legal-privacy-notice-2026-10-15').first()).toContainText(MARKER);
  for (const a of ['privacy@rightdue.app', 'support@rightdue.app', 'security@rightdue.app']) {
    await expect(page.getByTestId('privacy-contacts').getByRole('link', { name: a })).toHaveAttribute('href', `mailto:${a}`);
  }
  expect(await page.locator('body').innerText()).not.toMatch(/vijeya@/i);
  await page.goto('/terms');
  await expect(page.getByTestId('terms-emails')).toContainText('Emails you switch on');
  await expect(page.getByTestId('terms-liability').getByTestId('draft-legal-terms-2026-10-15')).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(/vijeya@/i);
  const sec = await page.request.get('/.well-known/security.txt');
  expect(await sec.text()).toContain('Contact: mailto:security@rightdue.app');
});

test('signed in, USA: More → Help offers US letters and opens the page', async ({ page }) => {
  await signIn(page, 'r2-us-letters@rightdue.app');
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole('group', { name: 'Where you live' }).getByRole('button', { name: /USA/ }).click();
  await page.getByLabel(/Take-home pay a month/).fill('6000');
  await page.getByLabel(/Spending a month/).fill('2500');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^card$/i, balance: '5000', rate: '24.99' });
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await page.waitForURL('**/plan');
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  const more = nav.getByRole('button', { name: /^More/ });
  await more.click();
  const panel = page.locator('#rd-more-panel');
  const link = panel.getByRole('link', { name: /^US letters/ });
  await expect(link).toBeVisible();
  await link.click();
  await page.waitForURL('**/cant-pay/us-letters');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('US LETTERS');
  await expect(nav.getByRole('button', { name: /^More/ })).toHaveAttribute('data-current', 'true');
});
