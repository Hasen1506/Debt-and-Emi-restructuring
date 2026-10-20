/**
 * The debt chart with a real-looking book: several loans, a pay-whenever
 * loan from a person, and a lump sum. The axis stops where the balance
 * stops moving. Markers, the leftover and the schedule agree, on a desk
 * width and a phone.
 */
import { expect, signIn, test } from './fixtures';

const USER = {
  country: 'IN',
  income_type: 'salaried',
  display_name: 'Vijay',
  annual_income: '2400000',
  monthly_income: '180000',
  fixed_expenses: '55000',
  variable_expenses: '25000',
  savings_balance: '85000',
  primary_bank: 'HDFC Bank',
  location_tier: 'urban',
  tax_regime: 'new',
  efund_balance: '0',
  efund_target: '0',
  loans: [
    { id: 'home', loan_type: 'home_loan', bank: 'HDFC Bank', outstanding: '1850000', nominal_rate: '0.085', rate_type: 'floating', tenure_months_remaining: 120, scheduled_emi: '22800', property_use: 'self_occupied', lender_type: 'bank', balance_as_of: '2026-10-07', balance_recorded_at: '2026-10-07T04:30:00.000Z', balance_after_emi: false },
    { id: 'car', loan_type: 'auto_loan', bank: 'SBI', outstanding: '320000', nominal_rate: '0.095', rate_type: 'fixed', tenure_months_remaining: 28, scheduled_emi: '13200', lender_type: 'bank', balance_as_of: '2026-10-07', balance_recorded_at: '2026-10-07T04:30:00.000Z', balance_after_emi: false },
    { id: 'personal', loan_type: 'personal_loan', bank: 'Bajaj Finance', outstanding: '180000', nominal_rate: '0.16', rate_type: 'fixed', tenure_months_remaining: 18, scheduled_emi: '11800', lender_type: 'nbfc', balance_as_of: '2026-10-07', balance_recorded_at: '2026-10-07T04:30:00.000Z', balance_after_emi: false },
    { id: 'card', loan_type: 'credit_card', bank: 'HDFC Bank', outstanding: '95000', nominal_rate: '0.36', rate_type: 'fixed', tenure_months_remaining: 0, scheduled_emi: '5000', lender_type: 'bank', balance_as_of: '2026-10-01', balance_recorded_at: '2026-10-01T04:30:00.000Z' },
    { id: 'asha', loan_type: 'people_loan', bank: 'Asha', outstanding: '60000', nominal_rate: '0', rate_type: 'fixed', tenure_months_remaining: 0, scheduled_emi: '0', lender_type: 'other', people_interest: 'none', people_repay: 'whenever', balance_as_of: '2026-10-07', balance_recorded_at: '2026-10-07T04:30:00.000Z' },
    { id: 'chit', loan_type: 'people_loan', bank: 'Chit fund', outstanding: '45000', nominal_rate: '0', rate_type: 'fixed', tenure_months_remaining: 8, scheduled_emi: '0', repayment: 'bullet', lender_type: 'other', people_interest: 'none', people_repay: 'lump', people_due: '2027-06', balance_as_of: '2026-10-07', balance_recorded_at: '2026-10-07T04:30:00.000Z' },
  ],
};

test('trajectory chart: leftover stops the axis, and it matches the schedule', async ({ page }) => {
  await signIn(page, 'chart-golden@rightdue.app');
  await page.evaluate((user) => {
    document.cookie = `rightdue_user=${encodeURIComponent(JSON.stringify(user))}; path=/`;
  }, USER);
  await page.goto('/plan');
  const chart = page.locator('#main section', { hasText: 'TRAJECTORY · TOTAL DEBT OVER TIME' });
  await expect(chart).toBeVisible();
  await expect(chart.getByText(/₹[\d,]+ STAYS/)).toBeVisible();
  await expect(chart.getByText('HOME LOAN', { exact: false })).toBeVisible();
  await expect(chart.getByText('CHIT FUND', { exact: false })).toBeVisible();
  await expect(chart.getByText('Sep 2056')).toHaveCount(0);

  await page.getByRole('button', { name: 'SHOW ALL', exact: true }).click();
  const agree = await page.evaluate(() => {
    const svg = document.querySelector('#main section svg[role="img"]') as SVGSVGElement | null;
    const empty = { ok: false, last: null as { month: number; balance: number } | null, schedule: null as number | null, overlaps: [] as string[], outside: [] as string[], months: [] as number[] };
    if (!svg) return empty;
    const tips = [...svg.querySelectorAll('[data-month]')].map((n) => ({
      month: Number(n.getAttribute('data-month')),
      balance: Number(n.getAttribute('data-balance')),
    }));
    const last = tips[tips.length - 1] ?? null;
    const row = last ? document.querySelector(`#schedule tr[data-month="${last.month}"]`) : null;
    const texts = [...svg.querySelectorAll('text')].map((t) => {
      const b = (t as SVGGraphicsElement).getBBox();
      return { t: t.textContent || '', x: b.x, y: b.y, w: b.width, h: b.height };
    });
    const overlaps: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i], b = texts[j];
        if (a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1) overlaps.push(`${a.t} / ${b.t}`);
      }
    }
    const vb = svg.viewBox.baseVal;
    const outside = texts.filter((t) => t.x < -1 || t.y < -1 || t.x + t.w > vb.width + 1 || t.y + t.h > vb.height + 1).map((t) => t.t);
    return {
      ok: true,
      last,
      schedule: row ? Number(row.getAttribute('data-balance')) : null,
      overlaps,
      outside,
      months: tips.map((t) => t.month),
    };
  });
  expect(agree.ok).toBeTruthy();
  expect(agree.last).not.toBeNull();
  expect(agree.schedule).toBe(agree.last?.balance);
  expect(agree.overlaps).toEqual([]);
  expect(agree.outside).toEqual([]);
  expect(Math.max(...agree.months)).toBeLessThan(120);

  await page.setViewportSize({ width: 390, height: 844 });
  const phone = await page.evaluate(() => {
    const svg = document.querySelector('#main section svg[role="img"]');
    const texts = [...svg!.querySelectorAll('text')].map((t) => {
      const b = (t as SVGGraphicsElement).getBBox();
      return { t: t.textContent || '', x: b.x, y: b.y, w: b.width, h: b.height };
    });
    const overlaps: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i], b = texts[j];
        if (a.x < b.x + b.w - 1 && a.x + a.w > b.x + 1 && a.y < b.y + b.h - 1 && a.y + a.h > b.y + 1) overlaps.push(`${a.t} / ${b.t}`);
      }
    }
    return { overlaps, stays: texts.some((t) => /STAYS/.test(t.t)) };
  });
  expect(phone.stays).toBeTruthy();
  expect(phone.overlaps).toEqual([]);
});
