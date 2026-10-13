'use client';

/**
 * Invest-vs-Prepay deep-dive tool.
 *
 * The /plan card answers the simple case (safe vehicles only). This tool
 * handles the harder case: variable-return options like equity / mutual
 * funds where you have a *distribution* of outcomes rather than a single
 * yield.
 *
 * v1 scope (this file):
 *   • User enters loan effective APR + their marginal tax rate.
 *   • Picks an instrument from a small catalogue (FD, tax-free bond,
 *     HYSA, Treasury, equity-MF) — instrument defaults populate the
 *     expected return + volatility sliders.
 *   • Deterministic comparison: nominal → after-tax → vs loan effective.
 *   • Risk-adjusted comparison: subtract one volatility-σ from expected
 *     return to get a conservative scenario; flips the verdict when
 *     the downside is below loan rate.
 *
 * Probabilistic Monte-Carlo + inflation-adjusted real-terms comparison
 * is queued for v2 (see ROADMAP / project memory).
 */

import { ivpAnswerNote } from '@/lib/ivp-answer-note';
import { INFLATION_FORECAST, readInflationRateClient } from '@/lib/inflation-modeling';
import { useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { Field, percentTextError } from '@/components/ToolPrimitives';
import { formatTaxRate } from '@/lib/tax-profile';
import { LChip, LChipRow, LKpi, LMathBlock, L_T } from '@/components/ledger/primitives';
import { LFieldGrid, LNote, LStep, LStepSub, LSteps, LVerdict } from '@/components/ledger/LToolSteps';
import {
  CLOSE_CALL,
  SAFE_RATES,
  afterTaxReturn,
  formatAsOf,
  quarterlyCompound,
  returnTaxRate,
  type ReturnTax,
} from '@/lib/invest-vs-prepay';
import { simulateMonteCarlo } from '@/lib/monte-carlo';
import { useCurrentProfile as useStoredProfile } from '@/lib/use-profile';
import { deriveMetrics } from '@/lib/derived';
import { loanLabel, loanName } from '@/lib/loan-types';

const D = (v: string | number | Decimal) => new Decimal(v);

interface Instrument {
  key: string;
  name: string;
  /** Default expected nominal annual return (decimal). */
  defaultReturn: number;
  /** Default annualised volatility (1σ, decimal). 0 for fixed-income. */
  defaultVol: number;
  /** How the return is taxed: at the user's rate (or a share of it),
   *  at a flat capital-gains rate, or not at all. */
  tax: ReturnTax;
  /** Free-text note shown under the instrument selector. */
  note: string;
  /** Compounding mode for the deterministic comparison. */
  compounding: 'simple' | 'quarterly' | 'monthly';
  /** For fixed-income defaults: the day the yield was true, and its source
   *  (shared with the /plan card through SAFE_RATES). */
  asOf?: string;
  source?: string;
}

/** A fixed-income instrument from the same dated yields /plan uses. */
function safe(key: keyof typeof SAFE_RATES, name: string, note: string): Instrument {
  const r = SAFE_RATES[key];
  return {
    key,
    name,
    defaultReturn: Number(r.rate),
    defaultVol: 0,
    tax: r.tax,
    note,
    compounding: r.compounding,
    asOf: r.asOf,
    source: r.source,
  };
}

const INSTRUMENTS_IN: Instrument[] = [
  safe('fd_in', 'Bank FD', 'Interest added quarterly · taxed at your rate'),
  safe('tax_free_bond_in', 'Tax-free bonds (NHAI / REC)', 'Interest is tax-free · paid twice a year'),
  {
    key: 'equity_mf_in',
    name: 'Equity fund (Nifty / flexi-cap)',
    defaultReturn: 0.12,
    defaultVol: 0.18,
    tax: { kind: 'flat', rate: 0.125 },
    note: 'Has averaged ~12% a year, swinging ~18% · gains taxed at 12.5% above ₹1.25L',
    compounding: 'simple',
  },
];

const INSTRUMENTS_US: Instrument[] = [
  safe('hysa_us', 'High-yield savings', 'Quoted as APY · taxed at your federal and state rate'),
  safe('treasury_us', '1-year Treasury',
    'Federal tax only (no state tax), so ~80% of your rate'),
  {
    key: 'spx_us',
    name: 'S&P 500 index fund',
    defaultReturn: 0.10,
    defaultVol: 0.16,
    tax: { kind: 'flat', rate: 0.15 },
    note: 'Has averaged ~10% a year, swinging ~16% · gains taxed at 15%',
    compounding: 'simple',
  },
];

/** A Decimal from a text field, or null when it isn't a number. */
function parseNum(v: string): Decimal | null {
  if (v.trim() === '') return null;
  try {
    const d = D(v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export function InvestVsPrepayDeepTool() {
  // Start from the profile: its dearest loan's effective rate (pick
  // another loan to switch), its tax rate, and what its country invests in.
  const profile = useStoredProfile();
  const country = profile.user.country;
  const loans = useMemo(
    () =>
      deriveMetrics(profile)
        .loans.filter((l) => l.outstanding.gt(0))
        .sort((x, y) => y.effective.cmp(x.effective)),
    [profile],
  );
  const pctOf = (d: Decimal) => d.mul(100).toFixed(2);
  const [picked, setPicked] = useState<number | null>(loans[0]?.index ?? null);
  const [loanRatePct, setLoanRatePct] = useState(loans[0] ? pctOf(loans[0].effective) : '');
  // Live re-test 3 NEW-18: the same tax rate, to one decimal, as Home,
  // Plan, Profile and Tax (formatTaxRate); 16 here read against 15.6% there.
  const profileMarginal = formatTaxRate(profile.marginalRate ?? 0.3).replace(/%$/, '');
  // The calculation uses the profile's exact rate while the box still shows it.
  const exactMarginalPct = new Decimal(profile.marginalRate ?? 0.3).mul(100).toString();
  const [marginalPct, setMarginalPct] = useState(profileMarginal);
  // Years held drives the simulation: shares even out over longer spells.
  const [yearsHeld, setYearsHeld] = useState('5');
  // The same rate as Plan: the central bank's forecast, or the user's own
  // (a cookie, so read after hydration).
  const [inflationPct, setInflationPct] = useState((Number(INFLATION_FORECAST[country].rate) * 100).toFixed(1));
  useEffect(() => {
    const own = readInflationRateClient();
    if (own) setInflationPct((Number(own) * 100).toFixed(1));
  }, []);

  const instruments = country === 'IN' ? INSTRUMENTS_IN : INSTRUMENTS_US;
  const [instKey, setInstKey] = useState(instruments[0].key);
  const inst = instruments.find((i) => i.key === instKey) ?? instruments[0];

  const [expReturnPct, setExpReturnPct] = useState(
    (inst.defaultReturn * 100).toFixed(2),
  );
  const [volPct, setVolPct] = useState((inst.defaultVol * 100).toFixed(1));
  // A dated default yield is fine for a clear answer. When the answer is
  // within a point, it turns on today's yield: the verdict waits until the
  // user types one in, or says to use the default anyway.
  const [yieldConfirmed, setYieldConfirmed] = useState(false);

  function applyInstrument(key: string) {
    const next = instruments.find((i) => i.key === key) ?? instruments[0];
    setInstKey(key);
    setExpReturnPct((next.defaultReturn * 100).toFixed(2));
    setVolPct((next.defaultVol * 100).toFixed(1));
    setYieldConfirmed(false);
  }

  const pickedLoan = loans.find((l) => l.index === picked)?.loan ?? null;
  const theLoan = pickedLoan ? `the ${loanName(pickedLoan)}` : 'the loan';
  const swings = inst.defaultVol > 0;

  // Live re-test 3 R3-3: "abc" or "500" gets the same inline error as
  // Setup's rate (R2-1), not a silent "enter the rate".
  const rateErrors = {
    loan: percentTextError(loanRatePct, { what: 'A loan rate' }),
    marginal: percentTextError(marginalPct, { what: 'A tax rate' }),
    ret: percentTextError(expReturnPct, { min: -99, what: 'A return' }),
    vol: swings ? percentTextError(volPct, { max: 500, what: 'A swing' }) : null,
    inflation: swings ? percentTextError(inflationPct, { min: -50, what: 'Inflation' }) : null,
  };

  // R4-1: name the field that stops the answer, not always the first two.
  const answerNote = ivpAnswerNote([
    { name: 'the loan’s rate', text: loanRatePct, error: rateErrors.loan },
    { name: 'your tax rate', text: marginalPct, error: rateErrors.marginal },
    { name: inst.asOf ? 'today’s rate' : 'what it earns a year', text: expReturnPct, error: rateErrors.ret },
    { name: 'how much it swings', text: volPct, error: rateErrors.vol, shown: swings },
  ]);

  const result = useMemo(() => {
    if (percentTextError(loanRatePct) || percentTextError(marginalPct) || percentTextError(expReturnPct, { min: -99 })
      || percentTextError(volPct, { max: 500 })) return null;
    const loanIn = parseNum(loanRatePct);
    const marginalIn = marginalPct.trim() === profileMarginal ? D(exactMarginalPct) : parseNum(marginalPct);
    const returnIn = parseNum(expReturnPct);
    const volIn = parseNum(volPct);
    if (!loanIn || !marginalIn || !returnIn || !volIn || loanIn.lt(0) || loanIn.gt(100)
      || marginalIn.lt(0) || marginalIn.gt(100) || returnIn.lte(-100) || returnIn.gt(100)
      || volIn.lt(0) || volIn.gt(500)) return null;
    const loan = loanIn.div(100);
    const marginal = Decimal.min(1, Decimal.max(0, marginalIn.div(100)));
    const expReturn = returnIn.div(100);
    const vol = Decimal.max(0, volIn.div(100));

    let preTax: Decimal;
    if (inst.compounding === 'quarterly') preTax = quarterlyCompound(expReturn);
    else if (inst.compounding === 'monthly') {
      preTax = expReturn.div(12).plus(1).pow(12).minus(1);
    } else preTax = expReturn;

    // After tax, by the instrument's rule: the user's rate (a Treasury pays
    // ~80% of it), a flat capital-gains rate, or none. /plan uses the same.
    const taxRate = returnTaxRate(inst.tax, marginal);
    const afterTax = afterTaxReturn(preTax, inst.tax, marginal);

    // A bad year: expected return less one year's swing (1σ). For fixed
    // income (no swing) it is the expected return.
    const downsideReturn = expReturn.minus(vol);
    let downsidePreTax: Decimal;
    if (inst.compounding === 'quarterly') {
      downsidePreTax = downsideReturn.lt(D('-0.99'))
        ? D('-0.99')
        : quarterlyCompound(downsideReturn);
    } else {
      downsidePreTax = downsideReturn;
    }
    const downsideAfterTax = afterTaxReturn(downsidePreTax, inst.tax, marginal);

    const expectedSpread = afterTax.minus(loan);
    const downsideSpread = downsideAfterTax.minus(loan);
    const p = (d: Decimal) => `${d.abs().mul(100).toFixed(2)}%`;

    let verdict: 'prepay' | 'invest' | 'borderline';
    let headline: string;
    let explanation: string;
    if (expectedSpread.gt(D('0.005'))) {
      if (downsideSpread.gt(0)) {
        verdict = 'invest';
        headline = `Invest: ${inst.name} beats ${theLoan}, even in a bad year.`;
        explanation = `In a bad year it still earns ${p(downsideAfterTax)} after tax, more than the loan's ${loan.mul(100).toFixed(2)}%.`;
      } else {
        verdict = 'borderline';
        headline = `Close call: ${inst.name} wins on average, loses in a bad year.`;
        explanation = `On average it beats the loan by ${p(expectedSpread)} a year after tax, but in a bad year it falls ${p(downsideSpread)} behind. Prepay if you'd rather not take that risk; invest if you can sit through a bad year.`;
      }
    } else if (expectedSpread.lt(D('-0.005'))) {
      verdict = 'prepay';
      headline = `Prepay ${theLoan}.`;
      explanation = `It costs ${loan.mul(100).toFixed(2)}% a year; ${inst.name} earns ${p(afterTax)} after tax. Prepaying comes out ${p(expectedSpread)} a year ahead, with no risk.`;
    } else {
      verdict = 'borderline';
      headline = 'Close call: they come out about even.';
      explanation = `They're within half a point of each other. Pick on other things: whether you want the money to hand, or the loan gone.`;
    }

    return { preTax, taxRate, afterTax, downsideAfterTax, expectedSpread, downsideSpread, verdict, headline, explanation };
  }, [loanRatePct, marginalPct, expReturnPct, volPct, inst, theLoan, profileMarginal, exactMarginalPct]);

  // The simulation only adds something when the return swings.
  const mc = useMemo(() => {
    if (!result || !swings) return null;
    const years = parseNum(yearsHeld);
    const infl = parseNum(inflationPct);
    if (!years || years.lte(0) || years.gt(100) || !infl || infl.lt(0) || infl.gt(100)) return null;
    return simulateMonteCarlo({
      expectedReturn: result.preTax.toNumber(),
      volatility: Math.max(0, Number(volPct) / 100),
      years: years.toNumber(),
      taxRate: result.taxRate.toNumber(),
      inflation: Math.max(0, Number(inflationPct) / 100),
      trials: 5000,
    });
  }, [result, swings, volPct, yearsHeld, inflationPct]);

  // The default is dated and the answer is close: ask for today's yield.
  const needsYield =
    result !== null &&
    Boolean(inst.asOf) &&
    !yieldConfirmed &&
    result.expectedSpread.abs().lt(CLOSE_CALL);

  const loanRateDecimal = Number(loanRatePct) / 100;
  const probBeatNominal = mc?.probBeatLoanNominal(loanRateDecimal) ?? 0;
  const probPositiveReal = mc?.probBeatLoanReal(0) ?? 0;
  const pc = (n: number) => `${(n * 100).toFixed(2)}%`;
  const tone = needsYield || !result ? null : result.verdict === 'prepay' ? 'pos' : result.verdict === 'invest' ? 'accent' : null;
  const taxNote =
    inst.tax.kind === 'none' ? 'tax-free' : inst.tax.kind === 'flat' ? 'flat tax on gains' : inst.tax.share < 1 ? `${Math.round(inst.tax.share * 100)}% of your rate` : 'your rate';

  return (
    <LSteps>
      <LStep no="01" id="ivp-in" title="The loan and the money">
        {loans.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <LChipRow label="Which loan would you prepay?">
              {loans.map((l) => (
                <LChip
                  key={l.index}
                  on={picked === l.index}
                  onClick={() => {
                    setPicked(l.index);
                    setLoanRatePct(pctOf(l.effective));
                  }}
                >
                  {loanLabel(l.loan)} · {pctOf(l.effective)}%
                </LChip>
              ))}
            </LChipRow>
          </div>
        )}
        <LFieldGrid min={200}>
          <Field
            label="The loan's rate, a year (%)"
            value={loanRatePct}
            onChange={(v) => {
              setLoanRatePct(v);
              // UX50 O-2: retyping the picked loan's own rate (or another
              // loan's) keeps that loan named in the answer; only a rate no
              // loan has turns it into "the loan".
              const n = Number(v);
              const same = v.trim() !== '' && Number.isFinite(n) ? loans.find((l) => Number(pctOf(l.effective)) === n) : undefined;
              setPicked(same ? (picked !== null && loans.some((l) => l.index === picked && Number(pctOf(l.effective)) === n) ? picked : same.index) : null);
            }}
            hint="What it costs a year: compounded, with GST on a card, after any tax break"
            error={rateErrors.loan}
          />
          <Field
            label="Your tax rate (%)"
            value={marginalPct}
            onChange={setMarginalPct}
            hint={marginalPct === profileMarginal ? 'From your profile' : undefined}
            error={rateErrors.marginal}
          />
        </LFieldGrid>

        <div style={{ marginTop: 16 }}>
          <LChipRow label="Or put the money in">
            {instruments.map((i) => (
              <LChip key={i.key} on={i.key === instKey} onClick={() => applyInstrument(i.key)}>
                {i.name}
              </LChip>
            ))}
          </LChipRow>
          <LNote style={{ margin: '6px 0 12px' }}>
            {inst.note}
            {inst.asOf && inst.source && (
              <>
                {' '}· {(inst.defaultReturn * 100).toFixed(2)}% is the {inst.source}, {formatAsOf(inst.asOf)}
              </>
            )}
          </LNote>
        </div>
        <LFieldGrid min={200}>
          <Field
            label={inst.asOf ? "Today's rate (%)" : 'It earns a year, on average (%)'}
            value={expReturnPct}
            onChange={(v) => {
              setExpReturnPct(v);
              setYieldConfirmed(true);
            }}
            error={rateErrors.ret}
          />
          {swings && <Field label="How much it swings a year (%)" value={volPct} onChange={setVolPct} hint="One standard deviation" error={rateErrors.vol} />}
          {swings && <Field label="Years you'd hold it" kind="integer" value={yearsHeld} onChange={setYearsHeld} />}
          {swings && <Field label="Prices rise a year (%)" value={inflationPct} onChange={setInflationPct} error={rateErrors.inflation} />}
        </LFieldGrid>
      </LStep>

      <LStep no="02" id="ivp-out" title="The answer" answer>
        {result === null ? (
          <LNote style={{ margin: 0 }}>{answerNote}</LNote>
        ) : (
          <>
            <LVerdict tone={tone}>{needsYield ? `Close: it turns on today's ${inst.name} rate.` : result.headline}</LVerdict>
            <LNote>
              {needsYield && inst.asOf ? (
                <>
                  After tax it earns {pc(result.afterTax.toNumber())}, within a point of the loan&apos;s {Number(loanRatePct).toFixed(2)}%.
                  The {(inst.defaultReturn * 100).toFixed(2)}% is the {inst.source}, {formatAsOf(inst.asOf)}. Enter today&apos;s rate
                  above, or{' '}
                  <button
                    type="button"
                    onClick={() => setYieldConfirmed(true)}
                    style={{ background: 'none', border: 'none', padding: 0, color: L_T.accent, textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
                  >
                    use {(inst.defaultReturn * 100).toFixed(2)}% anyway
                  </button>
                  .
                </>
              ) : (
                result.explanation
              )}
            </LNote>
            <LKpi
              items={[
                { l: 'THE LOAN COSTS', v: `${Number(loanRatePct).toFixed(2)}%`, s: 'a year' },
                { l: 'IT EARNS', v: pc(result.afterTax.toNumber()), s: 'a year, after tax' },
                ...(swings ? [{ l: 'IN A BAD YEAR', v: pc(result.downsideAfterTax.toNumber()), s: 'after tax' }] : []),
                {
                  l: result.expectedSpread.gte(0) ? 'INVESTING AHEAD BY' : 'PREPAYING AHEAD BY',
                  v: pc(result.expectedSpread.abs().toNumber()),
                  s: 'a year',
                  tone: result.expectedSpread.gte(0) ? L_T.accent : L_T.positive,
                },
              ]}
            />
            {swings && !mc && (
              <LNote style={{ margin: '16px 0 0' }}>
                {rateErrors.inflation
                  ? 'Fix "Prices rise a year" to see the 5,000 runs (beats the loan, keeps up with prices).'
                  : 'Fix the years held and "Prices rise a year" (0 to 100%) to see the 5,000 runs.'}
              </LNote>
            )}
            {mc && (
              <div style={{ marginTop: 16 }}>
                <LStepSub right="5,000 RUNS">Over {yearsHeld} years</LStepSub>
                <LKpi
                  items={[
                    { l: 'BEATS THE LOAN', v: `${(probBeatNominal * 100).toFixed(0)}%`, s: 'of runs' },
                    { l: 'KEEPS UP WITH PRICES', v: `${(probPositiveReal * 100).toFixed(0)}%`, s: 'of runs' },
                    { l: 'MIDDLE RESULT', v: pc(mc.percentilesNominal[50]), s: 'a year, after tax' },
                    { l: '1 IN 20 DOES WORSE THAN', v: pc(mc.percentilesNominal[5]), s: 'a year' },
                  ]}
                />
                <LNote style={{ margin: '10px 0 0' }}>
                  {probBeatNominal >= 0.75
                    ? `It beat the loan in ${(probBeatNominal * 100).toFixed(0)}% of runs: investing wins clearly on these numbers.`
                    : probBeatNominal <= 0.4
                      ? `It beat the loan in only ${(probBeatNominal * 100).toFixed(0)}% of runs: prepaying is the safer choice.`
                      : `It beat the loan in ${(probBeatNominal * 100).toFixed(0)}% of runs, close to a coin toss. Invest only if you can live with the 1-in-20 case of ${pc(mc.percentilesNominal[5])} a year.`}
                  {probBeatNominal >= 0.75 && probPositiveReal < 0.5
                    ? ` But only ${(probPositiveReal * 100).toFixed(0)}% of runs keep up with prices.`
                    : ''}
                </LNote>
              </div>
            )}
          </>
        )}
      </LStep>

      {result && (
        <LMathBlock
          rows={[
            { k: 'the loan costs', v: `${Number(loanRatePct).toFixed(2)}%`, note: 'a year, after any tax break' },
            {
              k: 'it earns, before tax',
              v: pc(result.preTax.toNumber()),
              note: inst.compounding === 'quarterly' ? `${inst.name}, ${Number(expReturnPct).toFixed(2)}% added quarterly` : inst.name,
            },
            { k: 'tax on it', v: formatTaxRate(result.taxRate), note: taxNote },
            { k: 'after tax', v: pc(result.afterTax.toNumber()) },
            ...(swings ? [{ k: 'in a bad year', v: pc(result.downsideAfterTax.toNumber()), note: `${Number(volPct).toFixed(1)}% below average, after tax` }] : []),
            {
              k: result.expectedSpread.gte(0) ? 'investing ahead by' : 'prepaying ahead by',
              v: pc(result.expectedSpread.abs().toNumber()),
              tone: result.expectedSpread.gte(0) ? undefined : ('pos' as const),
            },
            ...(mc
              ? [
                  {
                    k: `range over ${yearsHeld} years`,
                    v: `${pc(mc.percentilesNominal[5])} to ${pc(mc.percentilesNominal[95])}`,
                    note: `9 in 10 runs, a year after tax; ${pc(mc.percentilesReal[50])} after prices`,
                  },
                ]
              : []),
          ]}
        />
      )}
    </LSteps>
  );
}
