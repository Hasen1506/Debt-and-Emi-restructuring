/**
 * Derived "Letter" content — the headline + marginalia notes that turn a
 * profile into an editorial-style explanation of what to do next.
 *
 * Extracted here so multiple home variants (editorial, ledger, …) can share
 * the same derived narrative while each renders it in its own visual style.
 * Pure functions, no React or styling — callers handle presentation.
 */
import Decimal from 'decimal.js';
import type { UserPayload } from './api';
import { fmt } from './effective-apr';
import type { LoanWithEffective } from './derived';

export interface Headline {
  prefix: string;
  /** Accent phrase shown on the second line (italic in editorial, plain in ledger). */
  accent: string;
}

const D24 = new Decimal('0.24');
const D30 = new Decimal('0.30');
const D10 = new Decimal('0.10');

export function buildHeadline(loudest: LoanWithEffective | null): Headline {
  if (!loudest) {
    return { prefix: 'Nothing to chase', accent: 'right now.' };
  }
  if (loudest.loan.loan_type === 'credit_card' && loudest.effective.gt(D30)) {
    return { prefix: 'Pay the card,', accent: 'then breathe.' };
  }
  if (loudest.effective.gt(D24)) {
    return {
      prefix: `Knock out the ${loudest.loan.bank || 'loudest'} line,`,
      accent: 'then breathe.',
    };
  }
  if (loudest.loan.loan_type === 'home_loan' && loudest.effective.lt(D10)) {
    return { prefix: 'Let the mortgage run —', accent: "it's earning its keep." };
  }
  return {
    prefix: `Chip away at the ${loudest.loan.bank || loudest.loan.loan_type} line,`,
    accent: 'one month at a time.',
  };
}

export interface MarginNote {
  date: string;
  txt: string;
}

export function buildMarginalia(
  loans: LoanWithEffective[],
  blended: Decimal,
  user: UserPayload,
): MarginNote[] {
  const notes: MarginNote[] = [];
  const card = loans.find((l) => l.loan.loan_type === 'credit_card' && l.outstanding.gt(0));
  const home = loans.find((l) => l.loan.loan_type === 'home_loan' && l.outstanding.gt(0));
  if (card) {
    const spread = card.effective.sub(card.nominal);
    notes.push({
      date: 'Note',
      txt: `Your ${card.loan.bank || 'card'} carries +${fmt(spread)} from GST alone. Banks quote nominal; the statement reflects effective.`,
    });
  } else if (home && user.country === 'IN') {
    const regime = user.tax_regime ?? 'new';
    if (regime === 'new') {
      notes.push({
        date: 'Note',
        txt: `Under the new regime, section 24b caps the home-loan deduction at ₹0 — so no tax shield on your ${home.loan.bank || 'mortgage'} interest.`,
      });
    } else {
      notes.push({
        date: 'Note',
        txt: `Under the old regime, you can deduct up to ₹2L of home-loan interest under 24b — already reflected in the effective rate.`,
      });
    }
  } else if (loans.length > 0) {
    notes.push({
      date: 'Note',
      txt: `Blended effective rate across your debts is ${fmt(blended)}. That's the number that compounds — not whatever a single statement shows.`,
    });
  }

  notes.push({
    date: 'Always',
    txt: '"No-cost EMI" rarely is. The real APR is usually 14–18% once GST and convenience fees are folded in.',
  });
  notes.push({
    date: 'Principle',
    txt: 'A 6-month emergency fund saves more interest than any clever prepayment — by stopping the next high-rate borrow before it starts.',
  });
  return notes;
}
