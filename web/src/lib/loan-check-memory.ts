/**
 * Audit 80+ A1: what Loan Check last found, kept on this device so the
 * plan's "where we disagree with a plain calculator" can count it (a loan
 * still on MCLR or base rate; a rate cut not passed on). Only the kind,
 * the amounts and the lender's name are kept; nothing is sent anywhere
 * until the plan asks the engine, and it is replaced by the next check.
 */
import type { LoanCheckResponse } from './api';
import type { LoanCheckFindingBody } from './insights';

const KEY = 'rightdue_loan_check_findings';
const MAX_AGE_DAYS = 120;

interface Stored {
  savedAt: string;            // ISO date
  findings: LoanCheckFindingBody[];
}

/** The findings worth counting from one Loan Check result. */
export function findingsFrom(res: LoanCheckResponse): LoanCheckFindingBody[] {
  return res.findings
    .filter((f) => (f.kind === 'old_benchmark' || f.kind === 'missed_rate_cut') && Number(f.amount_this_year) > 0)
    .map((f) => ({
      kind: f.kind as LoanCheckFindingBody['kind'],
      amount_this_year: String(Math.round(Number(f.amount_this_year))),
      overcharged_so_far: String(Math.max(0, Math.round(Number(f.overcharged_so_far) || 0))),
      lender: res.lender_name,
    }));
}

export function rememberLoanCheck(res: LoanCheckResponse, today = new Date()) {
  try {
    const stored: Stored = { savedAt: today.toISOString().slice(0, 10), findings: findingsFrom(res) };
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    /* storage blocked: the plan simply won't count it */
  }
}

export function readLoanCheckFindings(today = new Date()): LoanCheckFindingBody[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const s = JSON.parse(raw) as Stored;
    const age = (today.getTime() - new Date(s.savedAt).getTime()) / 86_400_000;
    if (!Array.isArray(s.findings) || !(age >= 0 && age <= MAX_AGE_DAYS)) return [];
    return s.findings.slice(0, 10);
  } catch {
    return [];
  }
}
