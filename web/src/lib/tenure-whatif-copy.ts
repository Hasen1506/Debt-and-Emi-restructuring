/**
 * The tenure what-if's result sentences (live test #26, live re-test 2 R2-3).
 * The gap sentence and the "gap borrowing at card rates" reason only apply
 * when the plan is short; a plan with no shortfall gets copy that fits it.
 * Pure, so web/tests can check every branch.
 */
export function tenureWhatIfCopy(args: {
  baselineShortfall: number;
  scenarioShortfall: number;
  /** Old EMI less new EMI, in the loan's currency (what the stretch frees). */
  freed: number;
  extraInterest: number;
  neverClears: boolean;
  scenarioNeverClears: boolean;
  money: (v: number) => string;
}): { gap: string | null; gapCloses: boolean; interest: string } {
  const { baselineShortfall, scenarioShortfall, freed, extraInterest, neverClears, scenarioNeverClears, money } = args;
  const short = baselineShortfall > 0.5;
  const gap = !short
    ? null
    : scenarioShortfall <= 0.5
      ? 'This month’s gap closes.'
      : `This month you’d still be short ${money(scenarioShortfall)}.`;
  let interest: string;
  if (neverClears) {
    interest = scenarioNeverClears
      ? "At this tenure the debt still doesn't clear, so there's no interest total to compare."
      : 'As things stand the debt never clears; with this tenure it does.';
  } else if (extraInterest >= 1) {
    interest = `About ${money(extraInterest)} more interest over the plan.`;
  } else if (extraInterest <= -1) {
    interest = short
      ? `About ${money(-extraInterest)} less interest over the plan, because the gap borrowing at card rates shrinks.`
      : // UX50 B-26: the cost first, then the condition the saving rests on.
        `On this loan alone, a longer tenure means more interest. Only if you put the ${money(Math.max(0, freed))} a month the lower EMI frees into your dearer loans, every month, does the whole plan come out about ${money(-extraInterest)} cheaper.`;
  } else {
    interest = 'About the same interest over the plan.';
  }
  return { gap, gapCloses: short && scenarioShortfall <= 0.5, interest };
}
