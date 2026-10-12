/**
 * Small pure helpers for the Loan Check screen (app/tools/loan-check), kept
 * here so node tests can load them without React.
 */
import Decimal from 'decimal.js';
import { formatPct, type LoanCheckLender, type LoanLenderType } from '@/lib/api';

/** "+0.25" / "-0.10" / "0.25" percentage points → signed fraction string. */
export function parseSpreadChange(text: string): { fraction: string | null; error: string | null } {
  const t = text.trim().replace('−', '-').replace(/%$/, '');
  if (!t) return { fraction: null, error: null };
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return { fraction: null, error: 'Enter points like +0.25 or -0.10.' };
  const d = new Decimal(t);
  if (d.abs().gt(5)) return { fraction: null, error: 'A spread change above 5 points is not plausible. Check it.' };
  return { fraction: d.div(100).toString(), error: null };
}

export const TOL = new Decimal('0.0005');

/** Signed gap in words, so a minus sign is never the only clue (L#7). */
export function gapWords(gap: Decimal): string {
  const pts = formatPct(gap.abs().toString(), 2);
  if (gap.gt(TOL)) return `${pts} above`;
  if (gap.lt(TOL.neg())) return `${pts} below`;
  return 'none';
}


export const OTHER = '__other__';

export interface LenderChoice {
  /** A listed lender's name, or OTHER. Empty: not chosen yet. */
  pick: string;
  /** The name typed for an unlisted lender. */
  otherName: string;
  /** The type typed for an unlisted lender. */
  otherType: LoanLenderType | '';
}

export const EMPTY_CHOICE: LenderChoice = { pick: '', otherName: '', otherType: '' };

/** Start from a saved loan's bank name: a listed lender, or "another". */
export function choiceFromName(name: string | undefined, list: LoanCheckLender[]): LenderChoice {
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return EMPTY_CHOICE;
  const hit = list.find((x) => x.name.toLowerCase() === n);
  return hit ? { ...EMPTY_CHOICE, pick: hit.name } : { pick: OTHER, otherName: name!.trim(), otherType: '' };
}

/** What the API needs: the name and the type, or what is still missing. */
export function resolveChoice(
  c: LenderChoice,
  list: LoanCheckLender[],
): { lender?: string; lender_type?: LoanLenderType; missing?: string } {
  if (!c.pick) return { missing: 'your lender' };
  if (c.pick === OTHER) {
    if (!c.otherType) return { lender: c.otherName.trim() || undefined, missing: 'what kind of lender it is' };
    return { lender: c.otherName.trim() || undefined, lender_type: c.otherType };
  }
  const hit = list.find((x) => x.name === c.pick);
  return { lender: c.pick, lender_type: hit?.type };
}

