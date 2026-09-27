/**
 * Tools metadata — shared across /tools, the home rail, and the masthead
 * statement number ("§8a-WINDFALL").
 *
 * Body components live alongside each route under app/tools/<slug>/tool.tsx
 * so this stays a flat metadata list. The order is the order users see.
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
}

export const TOOLS: ToolMeta[] = [
  {
    id: 'loan-check',
    tag: 'LC',
    name: 'Loan check',
    question: 'Is my bank passing on rate cuts?',
    sub: 'Compares your home-loan rate with every RBI repo move since you borrowed.',
    href: '/tools/loan-check',
    // Indian floating-rate home loans against RBI repo moves only.
    countries: ['IN'],
  },
  {
    id: 'windfall',
    tag: '8a',
    name: 'Spare cash',
    question: 'Got a bonus, or savings sitting idle?',
    sub: 'Splits it between your emergency fund and the right loan, and says where to park the rest.',
    href: '/tools/windfall',
  },
  {
    id: 'new-debt',
    tag: '8b',
    name: 'New debt check',
    question: 'Should I take this EMI?',
    sub: 'Tells you, before signing, if it breaks the plan.',
    href: '/tools/new-debt',
  },
  {
    id: 'liquidate',
    tag: '8c',
    name: 'Liquidate',
    question: 'Sell an asset to clear debt?',
    sub: 'After-tax yield vs highest effective APR.',
    href: '/tools/liquidate',
  },
  {
    id: 'right-time',
    tag: '8f',
    name: 'Right-time',
    question: 'Wait or borrow now?',
    sub: 'Reads RBI / Fed path. Is your rate likely to fall?',
    href: '/tools/right-time',
  },
  {
    id: 'nri-prepay',
    tag: 'FX',
    name: 'NRI prepay',
    question: 'Loan abroad, savings here?',
    sub: 'Adjusts for FX drift, repatriation, tax both sides.',
    href: '/tools/nri-prepay',
  },
  {
    id: 'purchase',
    tag: '8g',
    name: 'Purchase advisor',
    question: 'Planning a big buy?',
    sub: 'TCO + 3 levers when the plan is tight.',
    href: '/tools/purchase',
  },
  {
    id: 'invest-vs-prepay',
    tag: '8h',
    name: 'Invest vs prepay',
    question: 'Variable-return option?',
    sub: 'Equity / MF deep-dive — expected vs downside.',
    href: '/tools/invest-vs-prepay',
  },
];

/** Whether a tool covers users in `country`. */
export function toolCovers(tool: ToolMeta, country: Country): boolean {
  return !tool.countries || tool.countries.includes(country);
}

/** The tools that cover users in `country`, in order. */
export function toolsFor(country: Country): ToolMeta[] {
  return TOOLS.filter((t) => toolCovers(t, country));
}

const COUNTRY_NAME: Record<Country, string> = { IN: 'India', US: 'US' };

/** "INDIA ONLY" for a tool that covers one country. */
export function toolCoverageLabel(tool: ToolMeta): string {
  return `${(tool.countries ?? []).map((c) => COUNTRY_NAME[c]).join(' + ').toUpperCase()} ONLY`;
}
