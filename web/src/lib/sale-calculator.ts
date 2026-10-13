/**
 * Sell to repay as a calculator (sprint G10; founder's cut-list decision 1,
 * grill #50). The person chooses what they would sell; nothing here ranks
 * their holdings or says whether to sell. These helpers keep the page's
 * words neutral and testable.
 */
import type { AssetPayload, AssetType, Country, UserPayload } from './api';

/** The kinds of asset the calculator works out, per country, in a fixed
 *  order (by kind, never by what selling would gain). Each has its own tax
 *  rule in engine/asset_liquidation.py. */
export const SALE_ASSET_TYPES: Record<Country, ReadonlyArray<readonly [AssetType, string]>> = {
  IN: [
    ['real_estate', 'Property'],
    ['equity_stocks', 'Shares'],
    ['equity_mf', 'Equity fund'],
    ['debt_mf', 'Debt fund'],
    ['gold_physical', 'Gold'],
    ['gold_etf', 'Gold ETF'],
    ['sgb', 'Gold bond (SGB)'],
    ['fixed_deposit', 'Fixed deposit'],
    ['crypto', 'Crypto'],
    ['other', 'Something else'],
  ],
  US: [
    ['real_estate', 'Property'],
    ['equity_stocks', 'Stocks'],
    ['equity_mf', 'Fund or ETF'],
    ['debt_mf', 'Bond fund'],
    ['gold_physical', 'Gold'],
    ['gold_etf', 'Gold ETF'],
    ['fixed_deposit', 'CD'],
    ['crypto', 'Crypto'],
    ['other', 'Something else'],
  ],
};

/** Kinds with no defensible default growth rate: the person enters one. */
const NO_DEFAULT_GROWTH = new Set<string>(['crypto', 'other']);

export function needsOwnGrowth(user: Pick<UserPayload, 'asset_returns'> | null | undefined, type: string): boolean {
  const own = user?.asset_returns?.[type];
  return NO_DEFAULT_GROWTH.has(type) && (own == null || String(own) === '');
}

/** The person's own assets, in the order they added them (never sorted by
 *  value or by what a sale would gain), with their index. */
export function ownAssetsInOrder(assets: AssetPayload[] | undefined): { a: AssetPayload; i: number }[] {
  return (assets ?? [])
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => Number(a.current_market_value) > 0);
}

/** The one-line result: what the sale raises and what it does to the
 *  loan, with no "sell" or "keep". */
export function saleSummary(
  v: { net_proceeds: string; surplus?: string | null; net_benefit: string },
  fmt: (x: string | number) => string,
  debtBalance: number,
): string {
  const net = Number(v.net_proceeds);
  if (!(net > 0)) return 'After tax and selling costs, a sale would raise nothing towards the loan.';
  if (debtBalance > 0 && net >= debtBalance) {
    return `After tax and costs, a sale would raise ${fmt(v.net_proceeds)}: enough to clear the loan, with ${fmt(String(net - debtBalance))} left over.`;
  }
  if (debtBalance > 0) {
    return `After tax and costs, a sale would raise ${fmt(v.net_proceeds)}: ${Math.round((net / debtBalance) * 100)}% of the loan, leaving ${fmt(String(debtBalance - net))} still owed.`;
  }
  return `After tax and costs, a sale would raise ${fmt(v.net_proceeds)}.`;
}

/** Words the calculator never says about the person's holdings. */
export const ADVICE_WORDS = [/\bsell it and\b/i, /\bkeep it\.\s*$/i, /\brecommended\b/i, /\bbest (?:asset|holding) to sell\b/i, /\branked?\b/i];
