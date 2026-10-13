/**
 * Live re-test 6, R6-2/R6-3/R6-4 at 390px on a touch screen.
 *  - R6-2: every interactive element on Setup, Plan, Home and Can't pay is
 *    measured. Buttons, selects and links that stand alone get a 44px-tall
 *    box (UX50 C-04) and at least 24px wide (WCAG 2.5.8); a checkbox or radio
 *    is a 20px square that its flex row can't squeeze. Links inside a line of
 *    running text are the WCAG 2.5.8 inline exception and are not counted.
 *    R7-1: text inputs and textareas are measured too (44px tall).
 *  - R6-3: the Plan lump-sum box's placeholder fits.
 *  - R6-4: 0 months unpaid says nothing is unpaid.
 */
import type { Page } from '@playwright/test';
import { expect, fillLoan, makeSetupChoices, planPreviewSettled, signIn, test } from './fixtures';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const shots = process.env.FIX4_SHOTS;

interface Miss { what: string; w: number; h: number; why: string }

async function smallTargets(page: Page): Promise<Miss[]> {
  return page.evaluate(() => {
    const out: { what: string; w: number; h: number; why: string }[] = [];
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(
      // Live re-test 7 R7-1: text boxes and textareas count too (Can't pay's
      // were 28px, the Plan what-if boxes 30px).
      'button, a[href], select, [role="button"], input[type="checkbox"], input[type="radio"], ' +
        'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="hidden"]):not([type="file"]), textarea',
    ));
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === 'hidden' || cs.display === 'none') continue;
      // Visually hidden (skip links until focused, sr-only text).
      if (r.width <= 2 || r.height <= 2 || cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)') continue;
      if (el.closest('[aria-hidden="true"], [hidden], [inert]')) continue;
      // Parked above the page until focused ("Skip to content").
      if (r.bottom + window.scrollY <= 0) continue;
      if ((el as HTMLButtonElement).disabled) continue;
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 50);
      const what = `${el.tagName.toLowerCase()} "${name}"`;
      const w = Math.round(r.width * 10) / 10, h = Math.round(r.height * 10) / 10;
      const type = (el as HTMLInputElement).type;
      if (el.tagName === 'INPUT' && (type === 'checkbox' || type === 'radio')) {
        if (w < 19.5 || h < 19.5) out.push({ what, w, h, why: 'box under 20px' });
        if (Math.abs(w - h) > 1) out.push({ what, w, h, why: 'squeezed' });
        continue;
      }
      // WCAG 2.5.8 inline exception: a link in a sentence.
      if (el.tagName === 'A') {
        const parent = el.parentElement;
        const inline = cs.display === 'inline' && parent &&
          Array.from(parent.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim().length > 0);
        if (inline) continue;
      }
      if (h < 43.5) out.push({ what, w, h, why: 'under 44px tall' });
      if (w < 23.5) out.push({ what, w, h, why: 'under 24px wide' });
    }
    return out;
  });
}

async function expectTargets(page: Page, where: string) {
  const misses = await smallTargets(page);
  expect.soft(misses, `${where}: touch targets too small at 390px:\n${misses.map((m) => `${m.what} ${m.w}×${m.h} ${m.why}`).join('\n')}`).toEqual([]);
}

test('R6-2/R6-3/R6-4: touch targets at 390px, the lump-sum placeholder and 0 months unpaid', async ({ page, browserName }) => {
  const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  test.skip(!coarse, `${browserName} does not report a coarse pointer with hasTouch`);
  await signIn(page, 'golden-r6-touch@rightdue.app');
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel(/Take-home pay a month/).fill('90000');
  await page.getByLabel(/Spending a month/).fill('38000');
  await expectTargets(page, 'Setup step 1');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await expect(page).toHaveURL(/step=loans/);
  await fillLoan(page, 0, { kind: /^card$/i, balance: '200000', rate: '40' });
  await fillLoan(page, 1, { kind: /^personal$/i, balance: '50000', rate: '12', emi: '4500' });
  await expectTargets(page, 'Setup step 2');
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await expect(page).toHaveURL(/step=plan/);
  await planPreviewSettled(page);
  await makeSetupChoices(page);
  await expectTargets(page, 'Setup step 3');
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await page.waitForURL('**/plan');

  // Plan, with the what-if open (the +N YRS buttons and the lump-sum box).
  await expect(page.locator('#tenure-what-if').first()).toBeVisible();
  const whatIf = page.getByRole('button', { name: /WHAT IF/i }).first();
  if (await whatIf.isVisible().catch(() => false)) await whatIf.click();
  await expectTargets(page, 'Plan');
  // R6-3: every what-if box's placeholder fits inside it.
  const clipped = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('2d')!;
    return Array.from(document.querySelectorAll<HTMLInputElement>('input[placeholder]'))
      .filter((i) => i.getBoundingClientRect().width > 0)
      .map((i) => {
        const cs = getComputedStyle(i);
        c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const room = i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return { p: i.placeholder, need: Math.ceil(c.measureText(i.placeholder).width), room: Math.floor(room) };
      })
      .filter((x) => x.need > x.room);
  });
  expect(clipped, 'placeholders cut off at 390px').toEqual([]);
  if (shots) await page.screenshot({ path: `${shots}/after-r6-plan-390.png`, fullPage: true });

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeAttached();
  await expectTargets(page, 'Home');
  if (shots) await page.screenshot({ path: `${shots}/after-r6-home-390.png`, fullPage: true });

  await page.goto('/cant-pay');
  const months = page.getByTestId('cp-months');
  await expect(months).toBeVisible();
  await expectTargets(page, "Can't pay");
  // R6-4
  await months.fill('0');
  await expect(page.getByTestId('cp-cost-total')).toHaveText(/Nothing is unpaid yet: pay by the due date and there.s no extra cost\./);
  await expect(page.getByTestId('cp-cost-total')).not.toContainText('credit report');
  await months.fill('1');
  await expect(page.getByTestId('cp-cost-total')).toContainText('plus a missed payment on your credit report');
  if (shots) await page.screenshot({ path: `${shots}/after-r6-cantpay-390.png`, fullPage: true });
});
