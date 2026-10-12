/**
 * Tools metadata — shared across /tools, the home rail, and the masthead
 * statement number ("§8a-WINDFALL").
 *
 * Body components live alongside each route under app/tools/<slug>/tool.tsx
 * so this stays a flat metadata list. The order is the order users see.
 *
 * Six tools (verified for sprint G10 against this list and app/tools/*):
 * Spare cash, New debt check, Sell to repay, Invest or prepay, Loan check,
 * NRI prepay. The other folders under app/tools are old addresses that
 * redirect: cash-yield → windfall, recompute → /plan#what-if, purchase →
 * new-debt?mode=purchase (next.config.mjs). Loan check shows for India
 * only, NRI prepay for someone in the US with loans in India, so most
 * people see five.
 */
import type { Country } from './api';

export interface ToolMeta {
  /** Route slug (matches app/tools/<id>/). */
  id: string;
  /** Statement-number tag — used in the ledger masthead (§8a, §8b…). */
  tag: string;
  /** Short caps name (≤ 18 chars). */
  name: string;
  /** One-liner the user reads first ("Got a bonus?"). */
  question: string;
  /** One-liner explainer for the index row. */
  sub: string;
  /** Full deep-link href. */
  href: string;
  /** Countries the tool works for; all when absent. Home hides a tool
   *  that doesn't cover the user's country, and /tools marks it. */
  countries?: readonly Country[];
  /** Only for someone in the US with loans in India. */
  nriOnly?: boolean;
}

export const TOOLS: ToolMeta[] = [
  {
    id: 'windfall',
    tag: '8a',
    name: 'Spare cash',
    question: 'Got a bonus or spare cash?',
    sub: 'Splits it across your loans, emergency fund and goals, the best way or your way.',
    href: '/tools/windfall',
  },
  {
    id: 'new-debt',
    tag: '8b',
    name: 'New debt check',
    question: 'A new loan, an EMI offer, or a big purchase?',
    // Big purchase merged in here (roadmap PR I): one place to check new debt.
    sub: 'Checks a loan or EMI offer, or a home or car you plan to buy, against your plan before you sign.',
    href: '/tools/new-debt',
  },
  {
    id: 'liquidate',
    tag: '8c',
    name: 'Sell to repay',
    // A calculator on an asset the person picks, never a ranking of what
    // to sell (sprint G10; grill #50, founder's cut-list decision 1).
    question: 'What would selling something do to a loan?',
    sub: 'A calculator: the tax and costs on a sale you choose, and what it leaves after the loan. It doesn’t pick what to sell.',
    href: '/tools/liquidate',
  },
  {
    id: 'invest-vs-prepay',
    tag: '8h',
    name: 'Invest or prepay',
    question: 'Invest the money, or prepay a loan?',
    sub: 'A calculator: shares or funds in a normal and a bad year, against the loan’s rate. Not investment advice.',
    href: '/tools/invest-vs-prepay',
  },
  {
    id: 'loan-check',
    tag: 'LC',
    name: 'Loan check',
    question: 'Is my bank passing on rate cuts?',
    sub: 'Your home-loan rate against every RBI repo move since you borrowed.',
    href: '/tools/loan-check',
    // Indian floating-rate home loans against RBI repo moves only.
    countries: ['IN'],
  },
  {
    id: 'nri-prepay',
    tag: 'FX',
    name: 'NRI prepay',
    question: 'Loan in India, savings abroad?',
    sub: 'Prepay or keep the dollars, after exchange-rate drift and tax on both sides.',
    href: '/tools/nri-prepay',
    nriOnly: true,
  },
];

/** The tools that apply to this person, in order: a tool for one
 *  country only, or for NRIs only, is left out for everyone else. */
export function toolsFor(user: { country: Country; is_nri_us?: boolean }): ToolMeta[] {
  return TOOLS.filter(
    (t) => (!t.countries || t.countries.includes(user.country)) && (!t.nriOnly || user.is_nri_us === true),
  );
}
