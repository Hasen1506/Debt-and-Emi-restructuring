/**
 * The words under a loan's balance on Home (Your loans and cards).
 *
 * The status line names this month's payment *with its amount*
 * ("OCT EMI ₹18,100 TO PAY"), so the balance above it is never read as the
 * EMI. A foreign-currency balance's conversion is labelled as the balance
 * ("BALANCE ≈ $20,740") and sits with the balance, not under the status
 * (audit 2026-10-07 §1: "≈ $20,740" under "EMI TO PAY" read as the EMI).
 */
export type EmiStatus = 'first' | 'paid' | 'due' | 'part' | 'missed';

/** `kind` is "EMI" for loans and "MINIMUM" for cards; `amount` is formatted, or null when unknown. */
export function emiStatusLine(status: EmiStatus, mon: string, next: string, kind: 'EMI' | 'PAYMENT' | 'MINIMUM', amount: string | null): string {
  const what = amount ? `${kind} ${amount}` : kind;
  switch (status) {
    case 'first':
      return `FIRST ${what} IN ${next}`;
    case 'paid':
      return `AFTER ${mon} ${kind}`;
    case 'due':
      return `${mon} ${what} TO PAY`;
    case 'part':
      return `${mon} ${what} PART-PAID`;
    case 'missed':
      return `${mon} ${what} NOT PAID`;
  }
}

/** The converted balance, said as the balance. */
export function convertedBalanceLine(converted: string): string {
  return `BALANCE ≈ ${converted}`;
}
