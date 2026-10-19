/**
 * Live re-test 2, 13 Oct 2026 (LIVE-RETEST-2-2026-10-13.md):
 *  - R2-1: "8.5x" in a rate field is not 0%: inline error, no months left.
 *  - NEW-2: a short month that never clears: the schedule stops (for this
 *    capped persona, at "not fundable from <month>", C11) with no debt-free
 *    date anywhere; no 18+ digit ₹ figure anywhere.
 *  - L#26: the tenure what-if redraws the chart and table, with a toggle.
 *  - R2-3: a plan with no shortfall: the what-if doesn't mention a gap.
 *  - NEW-17: at 390 px the header is one row with a MENU button.
 *  - NEW-6: at 390 px no chart label overlaps another or the minimums note.
 */
import { expect, fillLoan, loanBlocks, makeSetupChoices, signIn, test, continueToPlan } from './fixtures';
import type { Page } from '@playwright/test';

async function setup(page: Page, email: string, takeHome: string, rateText?: string) {
  await signIn(page, email);
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel(/Take-home pay a month/).fill(takeHome);
  await page.getByLabel(/Spending a month/).fill('40000');
  await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
  await fillLoan(page, 0, { kind: /^card$/i, balance: '150000', rate: '42' });
  await fillLoan(page, 1, { kind: /^personal$/i, balance: '400000', rate: '14', emi: '13000' });
  await fillLoan(page, 2, { kind: /^home$/i, balance: '2500000', rate: '8.6', emi: '22000' });
  if (rateText) {
    const b = loanBlocks(page).nth(2);
    const rate = b.getByLabel('Interest rate, % a year');
    await rate.fill(rateText);
    await expect(b.getByText(/isn’t a valid rate\. Type it like 8\.5/)).toBeVisible();
    await expect(rate).toHaveAttribute('aria-invalid', 'true');
    // Not read as 0%: ₹25L ÷ ₹22,000 = 114 months was shown before.
    await expect(b.getByText(/About 114 months left/)).toHaveCount(0);
    await rate.fill('8.6');
    await expect(b.getByText(/isn’t a valid rate/)).toHaveCount(0);
    await expect(b.getByText(/About \d+ months left/)).toBeVisible();
  }
  // NEW-23: headers by type, not "LOAN 1".
  await expect(loanBlocks(page).nth(0)).toHaveAttribute('aria-label', 'Credit card');
  await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
  await makeSetupChoices(page);
  await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
  await continueToPlan(page);
}

const huge = /₹\s?\d{1,3}(,\d{2,3}){6,}/; // ₹ with 13+ digits

test('short month: schedule stops, what-if redraws the chart and table', async ({ page }) => {
  await setup(page, 'golden-retest2-short@rightdue.app', '70000', '8.5x');
  const main = page.locator('#main');

  await test.step('NEW-2: the schedule stops where the plan stops being fundable and says why', async () => {
    // Audit 80+ C11 (integration phase 5): this persona's gap borrowing hits
    // the card limit (a capped plan, infeasible_from_month), so the schedule
    // stops at that month: "not fundable from <month>", never a debt-free
    // date on paper ("DEBT-FREE AS THINGS STAND · Mar 2047").
    const heading = page.getByRole('heading', { name: /MONTH BY MONTH · AS THINGS STAND · NOT FUNDABLE FROM [A-Za-z]{3} \d{4}/ });
    await expect(heading).toBeVisible();
    const from = (await heading.textContent())!.match(/NOT FUNDABLE FROM ([A-Za-z]{3} \d{4})/)![1];
    await expect(main.getByTestId('schedule-stop')).toContainText(`NOT FUNDABLE FROM ${from} AS THINGS STAND`);
    // The headline, chart and schedule tell one story: no debt-free date.
    const chartSection = main.locator('section', { has: page.getByText('TRAJECTORY · TOTAL DEBT OVER TIME') });
    await expect(chartSection.locator('svg[role=img]')).toContainText(/NOT FUNDABLE FROM [A-Za-z]{3} \d{4}/);
    // (The stop line itself says "THERE IS NO DEBT-FREE DATE".)
    const dated = /DEBT-FREE( AS THINGS STAND)? ·|★ DEBT-FREE/;
    await expect(chartSection).not.toContainText(dated);
    await expect(main.locator('#schedule')).not.toContainText(dated);
    await expect(main.getByRole('heading', { level: 2 }).first()).not.toContainText(/^Debt-free:/);
    await expect(main).toContainText(/NOT FUNDABLE( AS IT STANDS)? FROM [A-Za-z]{3} \d{4}/);
    const all = main.getByRole('button', { name: /ALL \d+ MONTHS/ });
    const n = Number((await all.textContent())!.match(/ALL (\d+) MONTHS/)![1]);
    expect(n).toBeLessThanOrEqual(360);
    await all.click();
    const text = (await main.locator('#schedule').innerText()) ?? '';
    expect(text).not.toMatch(huge);
    expect(text).not.toMatch(/2125/);
  });

  await test.step('L#26: +5 YRS redraws the chart and table; a toggle goes back', async () => {
    const chart = main.locator('section', { has: page.getByText('TRAJECTORY · TOTAL DEBT OVER TIME') }).locator('svg[role=img]');
    const chartBefore = await chart.innerHTML();
    await page.getByRole('button', { name: '+5 YRS' }).click();
    const toggle = main.getByTestId('whatif-toggle');
    await expect(toggle).toContainText(/SHOWING THE WHAT-IF · HOME LOAN \+5 YRS/);
    await expect.poll(async () => chart.innerHTML()).not.toEqual(chartBefore);
    const chartAfter = await chart.innerHTML();
    expect(chartAfter).not.toEqual(chartBefore);
    await toggle.getByRole('button', { name: 'BACK TO MY PLAN' }).click();
    await expect(toggle).toContainText('SHOWING YOUR PLAN AS IT IS');
    await expect.poll(async () => chart.innerHTML()).toEqual(chartBefore);
    await toggle.getByRole('button', { name: 'SHOW THE WHAT-IF' }).click();
    await expect(toggle).toContainText(/SHOWING THE WHAT-IF/);
  });
});

test('no shortfall: what-if copy, 390 px header and chart labels', async ({ page }) => {
  await setup(page, 'golden-retest2-spend@rightdue.app', '120000');
  const main = page.locator('#main');

  await test.step('R2-3: no gap sentence when nothing is short', async () => {
    // UI revert 2: the longer-tenure card is open under the table again (4bc3dc8).
    await page.getByRole('button', { name: '+5 YRS' }).click();
    const status = main.locator('#tenure-what-if [role=status]');
    await expect(status).toContainText(/EMI ₹22,000 →/);
    await expect(status).not.toContainText(/gap/i);
  });

  await test.step('NEW-17: one-row header with a MENU button at 390', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    const header = page.locator('header.rd-masthead');
    const box = await header.boundingBox();
    expect(box!.height).toBeLessThan(90);
    const menu = page.getByRole('button', { name: /menu/i });
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await menu.click();
    await expect(page.getByRole('button', { name: /close/i })).toHaveAttribute('aria-expanded', 'true');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await expect(nav.getByRole('link', { name: 'Profile', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(page.getByRole('button', { name: /menu/i })).toBeFocused();
  });

  await test.step('NEW-6: chart labels and the minimums note never overlap at 390', async () => {
    const svg = main.locator('section', { has: page.getByText('TRAJECTORY · TOTAL DEBT OVER TIME') }).locator('svg[role=img]');
    await expect(svg).toBeVisible();
    const hits = await svg.evaluate((el) => {
      const texts = Array.from(el.querySelectorAll('text')).filter((t) => /·|MINIMUMS/.test(t.textContent ?? ''));
      const boxes = texts.map((t) => ({ s: t.textContent, b: (t as SVGTextElement).getBBox() }));
      const out: string[] = [];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i].b, b = boxes[j].b;
          if (a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y)
            out.push(`${boxes[i].s} × ${boxes[j].s}`);
        }
      // The dashed minimums line must not run through the note.
      const note = boxes.find((x) => /MINIMUMS/.test(x.s ?? ''));
      const dashed = el.querySelector('path[stroke-dasharray="5 4"]') as SVGPathElement | null;
      if (note && dashed) {
        const len = dashed.getTotalLength();
        for (let d = 0; d <= len; d += 2) {
          const p = dashed.getPointAtLength(d);
          const b = note.b;
          if (p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y + 2 && p.y <= b.y + b.height - 2) {
            out.push(`dashed line × ${note.s}`);
            break;
          }
        }
      }
      return out;
    });
    expect(hits).toEqual([]);
  });
});
