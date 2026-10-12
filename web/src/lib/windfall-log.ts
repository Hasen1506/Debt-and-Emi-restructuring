/**
 * Spare cash, after "I DID THIS · LOG IT" (live test #19 and #20, sprint L3).
 *
 * #19: logging moves the money, so the profile changes and the tool works
 * out a fresh split for the SAME amount against the new balances: the live
 * test saw "Logged: ₹50,000 → Credit card" above numbers about the personal
 * loan, with no change of heading. Once logged, the tool keeps what was
 * logged on screen and labels the recomputed section as the next round:
 * "Got another ₹50,000? Here's where it would go next".
 *
 * #20: a bonus, refund or gift has a date it came in. The Activity entry
 * (and the plan month it moves) used to be today, always. The tool now asks
 * for the date; it can't be in the future, and a date before a loan's last
 * entered balance is flagged, because that balance already includes it.
 */

export interface LoggedRound {
  /** "₹50,000 → Credit card", one per place the money went. */
  lines: string[];
  /** The amount logged, formatted. */
  amount: string;
  /** 'YYYY-MM-DD' the money came in. */
  date: string;
}

/** Heading for step 02 ("Where it goes"). */
export function whereItGoesHeading(logged: LoggedRound | null, amountNow: string): string {
  return logged ? `Got another ${amountNow}? Here's where it would go next` : 'Where it goes';
}

/** The line under that heading once a round is logged. */
export function nextRoundNote(logged: LoggedRound | null): string | null {
  if (!logged) return null;
  return `Already logged on ${logged.date}: ${logged.lines.join(', ')}. The split below is worked out on your balances after that payment. It is a what-if for the next ${logged.amount}, not what you logged.`;
}

/** Labels for the result tiles once a round is logged ("NEXT ROUND · …"). */
export function kpiPrefix(logged: LoggedRound | null): string {
  return logged ? 'IF YOU PAY IT AGAIN · ' : '';
}

export type DateCheck =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

/**
 * Check the date the money came in. `today` and `date` are 'YYYY-MM-DD' in
 * the user's country. `balanceDates` are the loans' `balance_as_of` dates for
 * the loans this split pays.
 */
export function checkReceivedDate(date: string, today: string, balanceDates: (string | undefined)[] = []): DateCheck {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    return { ok: false, error: 'Enter the date the money came in.' };
  }
  if (date > today) return { ok: false, error: "The date can't be in the future." };
  const later = balanceDates
    .map((d) => (d ?? '').slice(0, 10))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && date < d)
    .sort();
  if (later.length) {
    const d = later[later.length - 1];
    return {
      ok: true,
      warning: `That's before the balance you entered on ${d}, which already includes payments made before it. Logging it won't change that loan again; Activity still lists it.`,
    };
  }
  return { ok: true };
}
