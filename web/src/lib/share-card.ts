/**
 * A progress card to share, with no amounts on it (ROADMAP Big ideas,
 * grill "fun"). What it may show: the debt-free month, months shaved off,
 * and how many loans are cleared out of how many. What it never shows: a
 * balance, an EMI, a rate, a lender, an income. `assertNoAmounts` is the
 * guard, and the tests run it.
 */

export interface ShareInput {
  /** "May 2033", or null when the plan has no date. */
  debtFreeLabel: string | null;
  /** Calendar months sooner than the first date remembered (lib/months-shaved). */
  monthsShaved: number;
  loansCleared: number;
  loansTotal: number;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Throws if the text carries a currency sign or a number that isn't a
 *  month-year, a small count or a percentage of loans cleared. */
export function assertNoAmounts(text: string): void {
  if (/[₹$€£¥]|\b(rs\.?|inr|usd|lakh|crore|k\b)/i.test(text)) throw new Error('share card has a currency');
  for (const m of text.match(/\d+(?:[.,]\d+)*/g) ?? []) {
    const n = Number(m.replace(/,/g, ''));
    const year = /^(19|20)\d\d$/.test(m);
    if (!year && (m.includes(',') || m.includes('.') || n > 600)) throw new Error(`share card has an amount: ${m}`);
  }
}

export function shareLines(i: ShareInput): string[] {
  const lines: string[] = [];
  lines.push(i.debtFreeLabel ? `Debt-free by ${i.debtFreeLabel}` : 'Paying down my debts');
  if (i.monthsShaved > 0) lines.push(`${i.monthsShaved} month${i.monthsShaved === 1 ? '' : 's'} sooner than when I started`);
  // UX50 B-17: "0 of 3 cleared" on day one reads as a loss; say it started.
  if (i.loansTotal > 0 && i.loansCleared > 0) lines.push(`${i.loansCleared} of ${i.loansTotal} loans cleared`);
  else if (i.loansTotal > 0 && i.monthsShaved <= 0) lines.push('Started my payoff plan');
  return lines;
}

export function shareText(i: ShareInput): string {
  const t = `${shareLines(i).join('. ')}. Planned with RightDue.`;
  assertNoAmounts(t);
  return t;
}

/** A 1080×1080 SVG. */
export function shareCardSvg(i: ShareInput): string {
  const lines = shareLines(i);
  lines.forEach(assertNoAmounts);
  const [head, ...rest] = lines;
  const sub = rest
    .map((l, k) => `<text x="90" y="${610 + k * 70}" font-size="44" fill="#333">${esc(l)}</text>`)
    .join('');
  const pct = i.loansTotal > 0 ? Math.round((i.loansCleared / i.loansTotal) * 100) : 0;
  const bar = i.loansTotal > 0 && i.loansCleared > 0
    ? `<rect x="90" y="820" width="900" height="24" fill="#e5e1d8"/><rect x="90" y="820" width="${Math.round(9 * pct)}" height="24" fill="#1f6f43"/>`
    : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">` +
    `<rect width="1080" height="1080" fill="#f6f3ec"/>` +
    `<rect x="40" y="40" width="1000" height="1000" fill="none" stroke="#111" stroke-width="6"/>` +
    `<text x="90" y="180" font-family="monospace" font-size="32" letter-spacing="6" fill="#666">RIGHTDUE · PROGRESS</text>` +
    `<text x="90" y="470" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="72" font-weight="700" fill="#111">${esc(head)}</text>` +
    `<g font-family="ui-monospace, Menlo, Consolas, monospace">${sub}</g>${bar}` +
    `<text x="90" y="960" font-family="monospace" font-size="26" fill="#666">No amounts shown · rightdue.app</text>` +
    `</svg>`
  );
}
