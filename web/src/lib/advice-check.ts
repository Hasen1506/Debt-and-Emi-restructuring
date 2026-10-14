/**
 * A8: "Got advice from an assistant or a bank RM? Paste it and we'll check it."
 * Calls POST /api/advice-check (api/routes/advice_check.py → engine/advice_check.py):
 * fixed patterns pull the checkable claims out of the text, and each is
 * recomputed from the user's own loans and RBI's rules. No AI model is
 * called, nothing is stored, and the same text always gets the same answer.
 */
import { browserApiBase } from './api-base';

export interface AdviceLoan {
  loan_type: string;
  outstanding: number;
  rate: number | null;          // annual decimal
  emi: number | null;
  months_left: number | null;
  rate_type: 'floating' | 'fixed';
  bank: string;
}

export interface AdviceClaim {
  kind: string;
  quote: string;
  verdict: 'agree' | 'disagree' | 'cant_check';
  why: string;
  theirs: string | null;
  ours: string | null;
  loan: number | null;
  source: string | null;
}

export interface AdviceReport {
  headline: string;
  counts: { agree: number; disagree: number; cant_check: number };
  claims: AdviceClaim[];
  not_checked: string[];
  method: string;
}

export const ADVICE_MAX = 8000;

export async function checkAdvice(body: {
  text: string; loans: AdviceLoan[]; extra_target: number | null; strategy: string; country: 'IN' | 'US';
}): Promise<AdviceReport> {
  const r = await fetch(`${browserApiBase()}/api/advice-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
    body: JSON.stringify({
      ...body,
      text: body.text.slice(0, ADVICE_MAX),
      loans: body.loans.slice(0, 20).map((l) => ({ ...l, bank: (l.bank || '').slice(0, 40) })),
    }),
  });
  if (!r.ok) throw new Error('We couldn’t check that just now.');
  return r.json() as Promise<AdviceReport>;
}

export const VERDICT_LABEL: Record<AdviceClaim['verdict'], string> = {
  agree: 'AGREES',
  disagree: 'DISAGREES',
  cant_check: 'CAN’T CHECK',
};
