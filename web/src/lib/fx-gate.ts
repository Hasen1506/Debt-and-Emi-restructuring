/**
 * E6 (audit 80): Setup's exchange-rate gate.
 *
 * While today's rate is still being fetched, a currency is "pending", not
 * wrong: Continue waits for it (and says so) instead of showing "Enter
 * what 1 INR is worth" and refusing the step. Only a failed fetch with no
 * typed rate, or an implausible rate, is an error the person must fix.
 */
export type FxQuoteState = 'loading' | 'failed' | { rate: string; as_of?: string | null } | undefined;

export function fxGate(
  foreignCcys: readonly string[],
  fxRates: Readonly<Record<string, string | undefined>>,
  fxQuotes: Readonly<Record<string, FxQuoteState>>,
  userCcy: string,
): { pending: string[]; errors: Record<string, string> } {
  const pending: string[] = [];
  const errors: Record<string, string> = {};
  for (const c of foreignCcys) {
    const r = Number(fxRates[c]);
    if (!(r > 0)) {
      if (fxQuotes[c] === 'loading') {
        pending.push(c);
        continue;
      }
      errors[c] =
        fxQuotes[c] === 'failed'
          ? `Today's rate couldn't be fetched. Enter what 1 ${c} is worth in ${userCcy} (your bank's app shows it).`
          : `Enter what 1 ${c} is worth in ${userCcy}.`;
    } else if (r > 100000) {
      errors[c] = `That rate looks too large. Check the direction: 1 ${c} in ${userCcy}.`;
    }
  }
  return { pending, errors };
}

/** The Continue button's words while a rate is on its way. */
export const FX_WAIT_LABEL = 'GETTING TODAY’S RATE…';
