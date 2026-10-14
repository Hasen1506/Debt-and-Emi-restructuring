/**
 * Live re-test 13, R13-1 (all engines, phones): the credit-report and KFS
 * import panels ran past their own border, and at 320px the page scrolled
 * sideways. The file picker's "Choose File / No file chosen" text gave it an
 * intrinsic width of 327px (283px in Firefox) at the 16px phone font, with no
 * max-width, and the panels were `display: grid` with an implicit `auto`
 * column, which can't shrink below that. Fixed with
 * `gridTemplateColumns: minmax(0, 1fr)` on the panels and a global
 * `input[type='file'] { max-width: 100% }`.
 *
 * At 320 and 390 this opens Setup step 2 → UPLOAD CREDIT REPORT PDF, then
 * Profile → Loans → the credit report and KFS panels, and checks that no
 * visible element reaches past its bordered panel's inner edge and that the
 * document doesn't scroll horizontally. The 390 case matters even though it
 * never scrolled: there the overflow (to x 383) stayed inside the viewport,
 * which is why the page-overflow sweeps didn't catch it.
 */
import type { Page } from '@playwright/test';
import { expect, fillLoan, makeSetupChoices, openProfileSection, signIn, test } from './fixtures';

interface Fit { panel: string; outside: string[]; docW: number; vw: number }

/** Every visible descendant of the panel must lie inside its border. */
async function fit(page: Page, testId: string): Promise<Fit> {
  return page.evaluate((id) => {
    const s = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
    const sr = s.getBoundingClientRect();
    const cs = getComputedStyle(s);
    const left = sr.left + parseFloat(cs.borderLeftWidth);
    const right = sr.right - parseFloat(cs.borderRightWidth);
    const outside: string[] = [];
    for (const el of Array.from(s.querySelectorAll<HTMLElement>('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none') continue;
      if (r.right > right + 0.5 || r.left < left - 0.5) {
        const name = (el.dataset.testid ? `[${el.dataset.testid}] ` : '') +
          (el.innerText || (el as HTMLInputElement).value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
        outside.push(`${el.tagName.toLowerCase()} ${name} ${Math.round(r.left)}..${Math.round(r.right)}`);
      }
    }
    return {
      panel: `${Math.round(left)}..${Math.round(right)}`,
      outside,
      docW: document.documentElement.scrollWidth,
      vw: window.innerWidth,
    };
  }, testId);
}

async function expectFits(page: Page, testId: string, where: string) {
  await expect(page.getByTestId(testId)).toBeVisible();
  const f = await fit(page, testId);
  expect(f.outside, `${where}: past the ${testId} border (${f.panel}):\n${f.outside.join('\n')}`).toEqual([]);
  expect(f.docW, `${where}: the page scrolls sideways (${f.docW} > ${f.vw})`).toBeLessThanOrEqual(f.vw);
}

for (const width of [320, 390]) {
  test.describe(`R13-1 at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test(`R13-1: the credit report and KFS import panels fit inside their border at ${width}px`, async ({ page, browserName }) => {
      await signIn(page, `golden-r13-panels-${browserName}-${width}@rightdue.app`);
      await expect(page).toHaveURL(/\/onboarding$/);
      await page.getByLabel(/Take-home pay a month/).fill('120000');
      await page.getByLabel(/Spending a month/).fill('40000');
      await page.getByRole('button', { name: /CONTINUE · WHAT YOU OWE/ }).click();
      await expect(page).toHaveURL(/step=loans/);

      // Setup step 2 → UPLOAD CREDIT REPORT PDF (CreditReportImport inside SetupImportCard).
      await page.getByTestId('setup-import-upload').click();
      await expect(page.getByTestId('cr-file')).toBeVisible();
      await expectFits(page, 'cr-import', 'Setup step 2 upload');
      await expectFits(page, 'setup-import-card', 'Setup step 2 upload');
      await page.getByTestId('cr-close').click();
      await expect(page.getByTestId('cr-import')).toHaveCount(0);

      await fillLoan(page, 0, { kind: /^card$/i, balance: '150000', rate: '42' });
      await fillLoan(page, 1, { kind: /^personal$/i, balance: '400000', rate: '14', emi: '10931' });
      await page.getByRole('button', { name: /CONTINUE · SEE YOUR PLAN/ }).click();
      await expect(page).toHaveURL(/step=plan/);
      await makeSetupChoices(page);
      await page.getByRole('button', { name: /SAVE · OPEN MY PLAN/ }).click();
      await page.waitForURL('**/plan');

      // Profile → Loans → credit report, with the Experian guide open too.
      await page.goto('/profile');
      await openProfileSection(page, 'Loans');
      await page.getByTestId('cr-open').click();
      await page.getByTestId('cr-guide-open').click();
      await expect(page.getByTestId('cr-guide')).toBeVisible();
      await expectFits(page, 'cr-import', 'Profile → Loans credit report');
      await page.getByTestId('cr-close').click();
      await expect(page.getByTestId('cr-import')).toHaveCount(0);

      // Profile → Loans → KFS (file picker and "Or paste the text").
      await page.getByTestId('kfs-open').click();
      await expect(page.getByTestId('kfs-file')).toBeVisible();
      await expectFits(page, 'kfs-import', 'Profile → Loans KFS');
    });
  });
}
