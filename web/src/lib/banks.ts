/**
 * Bank lists mirrored from `engine/rate_cards.py`. Used by <BankCombobox>
 * to autocomplete bank names during onboarding and across tools so the
 * value the user enters lines up with the engine's rate-card keys.
 *
 * Keep this in sync with engine/rate_cards.py when bank lists change.
 */

import RATE_CARDS from './rate-cards.json';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * When the rate cards in engine/rate_cards.py were last verified ("Oct
 * 2026"), from the exported rate-cards.json. Surfaced in the
 * EffectiveAprBreakdown disclaimer so users know how fresh the
 * assumptions are.
 */
export const RATE_CARD_AS_OF = (() => {
  const [y, m] = RATE_CARDS.as_of.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
})();

export const BANKS_IN: readonly string[] = [
  // Tier A — read from the banks' own pages
  'SBI',
  'HDFC Bank',
  'ICICI Bank',
  'Axis Bank',
  'Kotak Mahindra',
  'PNB',
  // Tier B — indicative
  'Bank of Baroda',
  'Canara Bank',
  'Bank of India',
  'Union Bank',
  'Indian Bank',
  'Central Bank',
  'IDBI',
  'Yes Bank',
  'IDFC First',
  'IndusInd Bank',
  // Tier C — indicative
  'Federal Bank',
  'South Indian Bank',
  'RBL Bank',
  'Bandhan Bank',
  'AU SFB',
  'UCO Bank',
  'Bank of Maharashtra',
  'Punjab & Sind',
  'Karnataka Bank',
  'Karur Vysya',
  'City Union',
  'J&K Bank',
  'Ujjivan SFB',
  'Suryoday SFB',
  // Fintech & aggregator — indicative; users typically pick the brand
  // they applied through, even when the actual NBFC is a partner.
  'KreditBee',
  'Cred',
  'Google Pay',
  'PaisaBazaar',
] as const;

export const BANKS_US: readonly string[] = [
  // Tier A
  'JPMorgan Chase',
  'Bank of America',
  'Wells Fargo',
  'Citibank',
  'U.S. Bank',
  'Capital One',
  // Tier B
  'American Express',
  'Discover',
  'Goldman Sachs',
  'Ally Financial',
  'Truist',
  'PNC Financial',
  // Tier C
  'TD Bank',
  'Navy Federal Credit Union',
  'SoFi',
] as const;
