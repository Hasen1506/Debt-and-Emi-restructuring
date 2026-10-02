/**
 * Server half of Profile's payoff-order triptych (REDESIGN R6.3): runs the
 * three orders on Plan's inputs and writes out each one's numbers. Streams
 * in after the rest of Profile, behind <StrategyCompareLoading />.
 */
import { loadStrategyOutcomesFromCookies, type StrategyOutcome } from '@/components/plan/load-plan';
import { formatCurrencyWhole } from '@/lib/api';
import { userDefaultCurrency } from '@/lib/currency';
import { loadStrategyServer, STRATEGIES, type StrategyName } from '@/lib/strategy';
import { monthIndexToCountryLabel } from '@/lib/today';
import { StrategyTriptych, type StrategyFigures } from './StrategyTriptych';

export { StrategyCompareLoading } from './StrategyTriptych';

export async function StrategyCompare() {
  let data: Awaited<ReturnType<typeof loadStrategyOutcomesFromCookies>>;
  try {
    data = await loadStrategyOutcomesFromCookies();
  } catch {
    return (
      <StrategyTriptych
        active={await loadStrategyServer()}
        note="Couldn’t work out the three orders just now. Plan shows the one in use."
      />
    );
  }
  if (!data) {
    return (
      <StrategyTriptych
        active={await loadStrategyServer()}
        note="Each loan needs its rate and EMI before the orders can be compared."
      />
    );
  }

  const { active, country, outcomes } = data;
  const ccy = userDefaultCurrency(country);
  const money = (n: number) => formatCurrencyWhole(Math.abs(n), ccy);
  const base = outcomes.avalanche;
  const date = (o: StrategyOutcome) =>
    o.short ? 'No date yet' : o.debtFreeMonth ? monthIndexToCountryLabel(o.debtFreeMonth, country) : 'Not in a lifetime';
  const versus = (s: StrategyName, o: StrategyOutcome) => {
    if (s === 'avalanche' || o.short || base.short) return '—';
    const diff = Number(o.totalInterest) - Number(base.totalInterest);
    if (Math.abs(diff) < 1) return 'Same';
    return `${diff > 0 ? '+' : '−'}${money(diff)}`;
  };
  const figures = Object.fromEntries(
    STRATEGIES.map((s) => {
      const o = outcomes[s];
      return [s, { date: date(o), interest: o.short ? '—' : money(Number(o.totalInterest)), vsAvalanche: versus(s, o) }];
    }),
  ) as Record<StrategyName, StrategyFigures>;

  const anyShort = STRATEGIES.some((s) => outcomes[s].short);
  // Within 0.1% reads the same on the cards.
  const allSame = STRATEGIES.every(
    (s) =>
      outcomes[s].debtFreeMonth === base.debtFreeMonth &&
      Math.abs(Number(outcomes[s].totalInterest) - Number(base.totalInterest)) <=
        Math.max(1, Number(base.totalInterest) * 0.001),
  );
  // The same numbers three times say less than one line does.
  if (anyShort) {
    return (
      <StrategyTriptych
        active={active}
        figures={figures}
        note="An order marked ‘No date yet’ runs short of cash in at least one month. Choose that order in Plan to see which month."
      />
    );
  }
  if (allSame) {
    const when = base.debtFreeMonth ? `debt-free in ${figures.avalanche.date}` : 'not debt-free in a lifetime';
    return (
      <StrategyTriptych
        active={active}
        note={`With these debts, all three orders come out the same: ${when}, ${figures.avalanche.interest} in interest.`}
      />
    );
  }
  return <StrategyTriptych active={active} figures={figures} />;
}
