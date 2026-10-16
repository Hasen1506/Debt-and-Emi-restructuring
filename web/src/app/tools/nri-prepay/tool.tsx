'use client';

import { whereToFind } from '@/lib/where-to-find';
import Decimal from 'decimal.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadProfileClient } from '@/lib/user-store';
import { loanCurrency as nativeLoanCurrency } from '@/lib/currency';
import {
  AddLoanAction,
  ApplyAction,
  Field,
  Select,
  SubmitBar,
} from '@/components/ToolPrimitives';
import { LBracket, LChip, LChipRow, LKpi, LMathBlock, L_T } from '@/components/ledger/primitives';
import { LFieldGrid, LNote, LStep, LSteps, LVerdict } from '@/components/ledger/LToolSteps';
import { Term } from '@/components/Term';
import { loanLabel } from '@/lib/loan-types';
import {
  api,
  formatCurrency,
  formatPct,
  type CrossBorderResponse,
  type LoanType,
} from '@/lib/api';
// UX fix 4: balances as owed today (after EMIs already paid), as Home shows.
import { useOwedTodayProfile as useStoredProfile } from '@/lib/use-profile';
import { deriveTenureMonths } from '@/lib/derived';
import { useFormErrors } from '@/lib/form-errors';
import { applyToolResult } from '@/lib/apply-tool-result';
import { addLoanBlocker, addLoanToProfile } from '@/lib/add-loan-to-profile';
import { userDefaultCurrency } from '@/lib/currency';

type Currency = 'INR' | 'USD' | 'GBP' | 'EUR' | 'AUD' | 'CAD' | 'SGD' | 'AED';

const CURRENCIES: { value: Currency; label: string }[] = [
  { value: 'INR', label: 'INR (₹)' },
  { value: 'USD', label: 'USD ($)' },
  { value: 'GBP', label: 'GBP (£)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'AUD', label: 'AUD' },
  { value: 'CAD', label: 'CAD' },
  { value: 'SGD', label: 'SGD' },
  { value: 'AED', label: 'AED' },
];

const VERDICT_LABEL: Record<CrossBorderResponse['verdict'], string> = {
  prepay: 'Prepay the loan.',
  invest: 'Keep paying the EMI, and keep your savings where they are.',
  marginal: 'Close call: within a point either way.',
};
const VERDICT_TONE: Record<CrossBorderResponse['verdict'], 'pos' | 'accent' | null> = {
  prepay: 'pos',
  invest: 'accent',
  marginal: null,
};


// The API's field names → this form's inputs, so a rejected value's
// message shows under the input it came from.
const FIELDS: Record<string, string> = {
  loan_balance: 'loanBalance',
  loan_nominal_rate: 'loanRate',
  loan_tenure_months: 'loanTenure',
  user_savings_yield: 'savingsYield',
  user_marginal_tax: 'marginalTax',
  manual_fx_rate: 'fxInverse',
  manual_fx_drift_annual: 'manualDrift',
};

export function NriPrepayTool() {
  const profile = useStoredProfile();
  // NRI-on-US-work-visa profile flag: when set, default user_currency to USD
  // and prefer INR for any tagged Indian loan. Saves users from re-selecting
  // currencies every visit.
  const profileIsNriUs = !!profile.user.is_nri_us;
  const profileUserCurrency: Currency =
    profileIsNriUs ? 'USD'
      : profile.user.country === 'US' ? 'USD'
        : 'INR';
  // The profile's own loan, not a sample: this used to open on a ₹35 lakh
  // loan whatever the user had entered. The first open instalment loan,
  // preferring one in a currency other than the user's (the NRI case).
  const firstLoanIdx = useMemo(() => {
    const open = profile.user.loans
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => Number(l.outstanding) > 0 && l.loan_type !== 'credit_card');
    const foreign = open.find(({ l }) => l.currency && l.currency !== profileUserCurrency);
    return profile.isLive ? String((foreign ?? open[0])?.i ?? '') : '';
  }, [profile.user.loans, profile.isLive, profileUserCurrency]);
  const [targetIdx, setTargetIdx] = useState<string>('');
  const [loanBalance, setLoanBalance] = useState('');
  const [loanRate, setLoanRate] = useState('');
  const [loanTenure, setLoanTenure] = useState('');
  const [loanCurrency, setLoanCurrency] = useState<Currency>('INR');
  // A rupee loan's figures are on Indian papers, a dollar loan's on US ones.
  const loanDocs = { country: loanCurrency === 'INR' ? 'IN' : 'US' };
  const [userCurrency, setUserCurrency] = useState<Currency>(profileUserCurrency);
  // What the user's savings earn and their tax rate, from the profile.
  const [savingsYield, setSavingsYield] = useState(() => {
    const best = (profile.user.investment_options ?? [])
      .filter((o) => o.liquidity_class === 'liquid')
      .map((o) => Number(o.expected_return))
      .filter((r) => r > 0);
    return profile.isLive && best.length ? String(Math.max(...best)) : '';
  });
  const [marginalTax, setMarginalTax] = useState(profile.isLive ? profile.marginalRate ?? '' : '');
  // User-facing FX field: "1 [userCurrency] = X [loanCurrency]" — e.g. for
  // USD-earner with INR loan, X ≈ 96. Engine wants the inverse direction
  // (user_currency per 1 loan_currency), so we convert before sending.
  // The rate as typed, in whichever direction gives a number above 1:
  // 'loan' = one loan-currency unit in the user's currency (the engine's
  // direction), 'user' = one user-currency unit in the loan's currency.
  const [fxText, setFxText] = useState('');
  const [fxPer, setFxPer] = useState<'loan' | 'user'>('user');
  const [fxNote, setFxNote] = useState<string | null>(null);
  // Where the rate in the field came from, for THE MATH.
  const [fxFrom, setFxFrom] = useState('');
  const [manualDrift, setManualDrift] = useState('');
  // What sending the money costs, all in (fee + the exchange-rate margin),
  // as a % of the amount. Typed by the person: it differs by bank and app
  // (sprint G10, NRI accuracy; grill #35). Blank = not counted, and the
  // answer says so.
  const [remitPct, setRemitPct] = useState('');
  // A saved loan shows as one line; EDIT opens its fields.
  const [editLoan, setEditLoan] = useState(false);
  const [more, setMore] = useState(false);
  const [resultValue, setV] = useState<CrossBorderResponse | null>(null);
  const fingerprint = JSON.stringify([targetIdx, loanBalance, loanRate, loanTenure, loanCurrency, userCurrency, savingsYield, marginalTax, fxText, fxPer, manualDrift, profile.user]);
  const [checked, setChecked] = useState('');
  const [resultProfileKey, setResultProfileKey] = useState('');
  const v = checked === fingerprint ? resultValue : null;
  const [busy, setBusy] = useState(false);
  const { err, setErr, clear, fail, failField, at } = useFormErrors();
  const [applied, setApplied] = useState(false);
  const [added, setAdded] = useState(false);

  function pickTargetLoan(idx: string) {
    setTargetIdx(idx);
    setV(null);
    if (idx === '') {
      setEditLoan(true);
      setLoanBalance('');
      setLoanRate('');
      setLoanTenure('');
      return;
    }
    setEditLoan(false);
    const i = Number(idx);
    if (!Number.isNaN(i) && profile.user.loans[i]) {
      const loan = profile.user.loans[i];
      setLoanBalance(loan.outstanding);
      setLoanRate(loan.nominal_rate);
      // Tenure as saved, else worked out from the balance, rate and EMI.
      const months =
        loan.tenure_months_remaining > 0
          ? loan.tenure_months_remaining
          : deriveTenureMonths(loan.outstanding, loan.nominal_rate, loan.scheduled_emi);
      setLoanTenure(months ? String(months) : '');
      // Honour the loan's tagged currency when present — set in onboarding
      // by NRI-US users. Falls back to the profile's country default.
      if (loan.currency) {
        setLoanCurrency(loan.currency as Currency);
      } else setLoanCurrency(userDefaultCurrency(profile.user.country));
    }
  }

  useEffect(() => {
    const selected = targetIdx !== '' && profile.user.loans[Number(targetIdx)];
    if (selected && Number(selected.outstanding) > 0 && selected.loan_type !== 'credit_card') pickTargetLoan(targetIdx);
    else if (firstLoanIdx !== '') pickTargetLoan(firstLoanIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstLoanIdx, profile.user.loans]);

  function showRate(userPerLoan: Decimal, from: string, mathNote: string) {
    if (userPerLoan.gte(1)) {
      setFxPer('loan');
      setFxText(userPerLoan.toDecimalPlaces(4).toString());
    } else {
      setFxPer('user');
      setFxText(new Decimal(1).div(userPerLoan).toDecimalPlaces(4).toString());
    }
    setFxNote(from);
    setFxFrom(mathNote);
  }

  // Today's rate first, every time: a rate saved months ago can be well
  // off. The profile's saved rate only stands in when the fetch fails.
  // `ask` drops an answer that lands after the currencies changed.
  const ask = useRef(0);
  async function fetchLiveRate(savedFallback?: number) {
    const n = ++ask.current;
    setFxNote('Fetching today’s rate…');
    try {
      const r = await api.fxRate(loanCurrency, userCurrency);
      const d = new Decimal(r.rate);
      if (!d.isFinite() || d.lte(0)) throw new Error('no rate');
      if (n !== ask.current) return;
      const day = r.as_of
        ? new Date(`${r.as_of}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : null;
      showRate(d, day ? `Today’s rate, as of ${day}` : 'Today’s rate', day ? `today’s rate, as of ${day}` : 'today’s rate');
    } catch {
      if (n !== ask.current) return;
      if (savedFallback && Number.isFinite(savedFallback) && savedFallback > 0) showRate(new Decimal(savedFallback), 'Today’s rate couldn’t be fetched: this is your profile’s.', 'your profile’s rate');
      else setFxNote(fxText.trim() ? 'Couldn’t refresh today’s rate. The rate shown has been kept; check it before calculating.' : 'Couldn’t fetch today’s rate. Type it in.');
    }
  }

  // Two currencies: fetch today's rate, so nobody has to look it up.
  // One currency: no rate needed.
  useEffect(() => {
    if (loanCurrency === userCurrency) {
      ask.current++;
      setFxText('');
      setFxNote(null);
      return;
    }
    setFxText('');
    setFxPer(loanCurrency === 'INR' ? 'user' : userCurrency === 'INR' ? 'loan' : 'user');
    const saved = Number(profile.user.fx_to_user_currency?.[loanCurrency]);
    void fetchLiveRate(userCurrency === userDefaultCurrency(profile.user.country) ? saved : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loanCurrency, userCurrency]);

  const enginefxRate = useMemo(() => {
    if (!fxText.trim()) return '';
    let v: Decimal;
    try {
      v = new Decimal(fxText);
    } catch {
      return '';
    }
    if (!v.isFinite() || v.lte(0)) return '';
    return (fxPer === 'loan' ? v : new Decimal(1).div(v)).toFixed(8);
  }, [fxText, fxPer]);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    const required: [string, string, string][] = [
      ['loanBalance', loanBalance, 'Enter what you still owe on the loan.'],
      ['loanRate', loanRate, 'Enter the loan’s interest rate.'],
      ['loanTenure', loanTenure, 'Enter the months left on the loan.'],
      ['savingsYield', savingsYield, 'Enter what your savings earn a year.'],
      ['marginalTax', marginalTax, 'Enter your tax rate on that interest.'],
    ];
    const missing = required.find(([, value]) => String(value).trim() === '');
    if (missing) {
      failField(missing[0], missing[2]);
      return;
    }
    setBusy(true);
    clear();
    setApplied(false);
    setAdded(false);
    const baselineKey = JSON.stringify(loadProfileClient().user);
    try {
      setV(
        await api.crossBorder({
          loan_balance: loanBalance,
          loan_nominal_rate: loanRate,
          loan_tenure_months: Number(loanTenure),
          loan_currency: loanCurrency,
          user_currency: userCurrency,
          user_savings_yield: savingsYield,
          user_marginal_tax: marginalTax,
          ...(enginefxRate ? { manual_fx_rate: enginefxRate } : {}),
          ...(manualDrift ? { manual_fx_drift_annual: manualDrift } : {}),
        }),
      );
      setChecked(fingerprint);
      setResultProfileKey(baselineKey);
    } catch (e) {
      fail(e, FIELDS);
    } finally {
      setBusy(false);
    }
  }

  // Show the response's fx_rate_used in the friendly direction. The
  // response field is user_currency per 1 loan_currency; invert for UI.
  const displayedFx = useMemo(() => {
    if (!v) return null;
    const r = new Decimal(v.fx_rate_used);
    if (r.lte(0)) return null;
    return r.gte(1)
      ? `1 ${loanCurrency} = ${r.toFixed(2)} ${userCurrency}`
      : `1 ${userCurrency} = ${new Decimal(1).div(r).toFixed(2)} ${loanCurrency}`;
  }, [v, loanCurrency, userCurrency]);

  // Saving the loan: its amounts are in the loan's currency, so it goes in
  // tagged with that currency and a rate into the profile's. The engine's
  // rate is into the currency picked above, which is only usable when that
  // is the profile's own.
  const profileCurrency = userDefaultCurrency(profile.user.country);
  const addInput = {
    currency: loanCurrency,
    fx_to_user: v && userCurrency === profileCurrency ? v.fx_rate_used : undefined,
  };
  const addBlocker =
    loanCurrency !== profileCurrency &&
    (loanCurrency === 'INR' || loanCurrency === 'USD') &&
    userCurrency !== profileCurrency &&
    !(Number(profile.user.fx_to_user_currency?.[loanCurrency]) > 0)
      ? `Your profile is in ${profileCurrency}. Pick ${profileCurrency} as the currency you earn in and check again to add this loan with its exchange rate.`
      : addLoanBlocker(addInput, profile.user);

  const openLoans = profile.user.loans
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => Number(l.outstanding) > 0 && l.loan_type !== 'credit_card');
  const picked = targetIdx !== '' ? profile.user.loans[Number(targetIdx)] : null;
  const moneyCcy = loanCurrency === 'INR' || loanCurrency === 'USD' ? loanCurrency : null;
  const twoCurrencies = loanCurrency !== userCurrency;
  const pct = (x: string | number) => formatPct(x, 2);

  return (
    <LSteps>
      <LStep no="01" id="nri-in" title="The loan and your savings">
        <form onSubmit={check} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {openLoans.length > 0 && (
            <LChipRow label="Which loan?">
              {openLoans.map(({ l, i }) => (
                <LChip key={i} on={targetIdx === String(i)} onClick={() => pickTargetLoan(String(i))}>
                  {loanLabel(l)} · {l.currency ?? userDefaultCurrency(profile.user.country)}
                </LChip>
              ))}
              <LChip on={targetIdx === ''} onClick={() => pickTargetLoan('')}>
                One not saved yet
              </LChip>
            </LChipRow>
          )}
          {picked && !editLoan ? (
            <p style={{ margin: 0, fontSize: 'var(--fs-body)', lineHeight: 1.6 }}>
              {formatCurrency(loanBalance, loanCurrency)} left at {pct(loanRate)}, {loanTenure} months to go.{' '}
              <LBracket onClick={() => setEditLoan(true)}>EDIT</LBracket>
            </p>
          ) : (
            <LFieldGrid min={200}>
              <Field
                label="Still owed, in the loan's currency"
                kind={moneyCcy ? 'money' : 'decimal'}
                currency={moneyCcy ?? undefined}
                value={loanBalance}
                error={at('loanBalance')}
                onChange={setLoanBalance}
                findIt={whereToFind('balance', loanDocs)}
              />
              <Field label="Its rate, a year" kind="percent" value={loanRate} error={at('loanRate')} onChange={setLoanRate} findIt={whereToFind('rate', loanDocs)} />
              <Field label="Months left" kind="integer" value={loanTenure} error={at('loanTenure')} onChange={setLoanTenure} findIt={whereToFind('monthsLeft', loanDocs)} />
              <Select label="The loan's currency" value={loanCurrency} onChange={setLoanCurrency} options={CURRENCIES} />
            </LFieldGrid>
          )}
          <LFieldGrid min={200}>
            <Select label="You earn and save in" value={userCurrency} onChange={setUserCurrency} options={CURRENCIES} />
            <Field
              label="Your savings earn, a year before tax"
              kind="percent"
              value={savingsYield}
              error={at('savingsYield')}
              onChange={setSavingsYield}
              hint="A savings account, T-bills, an FD or a fund"
            />
            <Field
              label="Your tax rate on that"
              kind="percent"
              value={marginalTax}
              error={at('marginalTax')}
              onChange={setMarginalTax}
              hint={profile.isLive && marginalTax === (profile.marginalRate ?? '') ? 'From your profile' : undefined}
            />
            {twoCurrencies && (
              <div>
                <Field
                  label={fxPer === 'loan' ? `1 ${loanCurrency} = how many ${userCurrency}` : `1 ${userCurrency} = how many ${loanCurrency}`}
                  value={fxText}
                  error={at('fxInverse')}
                  onChange={(t) => {
                    // A rate being typed wins over one still on its way.
                    ask.current++;
                    setFxText(t);
                    setFxNote(null);
                    setFxFrom('the rate you typed');
                  }}
                  hint={fxNote ?? undefined}
                />
                <div style={{ marginTop: 6 }}>
                  <LBracket onClick={() => void fetchLiveRate()}>REFRESH TODAY&apos;S RATE</LBracket>
                </div>
              </div>
            )}
          </LFieldGrid>
          {twoCurrencies && (
            <div>
              <LBracket onClick={() => setMore((m) => !m)}>{more ? '− LESS' : '+ MORE — OPTIONAL'}</LBracket>
              {!more && (
                <span style={{ fontSize: 'var(--fs-small)', color: L_T.muted, marginLeft: 8 }}>
                  How the exchange rate moves{manualDrift ? `: ${manualDrift}% a year` : ': its long-run trend'}
                </span>
              )}
              {more && (
                <div style={{ marginTop: 10, maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Field
                    label="Sending the money costs (%)"
                    kind="percent"
                    value={remitPct}
                    onChange={setRemitPct}
                    hint="Your bank's or app's fee plus the gap between its rate and the market rate. Ask it for the all-in cost of sending this amount."
                  />
                  <Field
                    label={`${loanCurrency} against ${userCurrency}, % a year`}
                    value={manualDrift}
                    error={at('manualDrift')}
                    onChange={setManualDrift}
                    hint={`Above 0: ${loanCurrency} gets stronger. Blank: the last 20 years' trend (the rupee has lost 2% to 5% a year, depending on the currency; 3.5% against the dollar).`}
                  />
                </div>
              )}
            </div>
          )}
          <SubmitBar busy={busy} error={err} label="Should I prepay?" />
        </form>
      </LStep>

      {v && (
        <LStep no="02" id="nri-out" title="The answer" answer>
          <LVerdict tone={VERDICT_TONE[v.verdict]}>{VERDICT_LABEL[v.verdict]}</LVerdict>
          <LNote>{v.rationale}</LNote>
          {/* E5 (audit 80): the transfer cost is shown, never silent. */}
          {v.comparison_line && <LNote>{v.comparison_line}</LNote>}
          <LKpi
            items={[
              { l: 'THE LOAN COSTS YOU', v: pct(v.effective_loan_cost_in_user_currency), s: `a year, in ${userCurrency}`, tone: L_T.negative },
              { l: 'YOUR SAVINGS EARN', v: pct(v.user_post_tax_yield), s: 'a year, after tax', tone: L_T.positive },
              {
                l: Number(v.spread) > 0 ? 'PREPAYING AHEAD BY' : 'SAVING AHEAD BY',
                v: pct(Math.abs(Number(v.spread))),
                s: 'a year',
              },
            ]}
          />
          <NriNotes
            spread={Number(v.spread)}
            remitPct={twoCurrencies ? remitPct : ''}
            loanCurrency={loanCurrency}
            userCurrency={userCurrency}
          />
          <div style={{ marginTop: 12 }}>
            <LKpi
              items={[
                { l: `EMI TODAY, IN ${userCurrency}`, v: formatCurrency(v.loan_emi_user_currency, userCurrency) },
                {
                  l: `EMI IN 5 YEARS, IN ${userCurrency}`,
                  v: formatCurrency(v.loan_emi_user_currency_y5, userCurrency),
                  tone: Number(v.loan_emi_user_currency_y5) > Number(v.loan_emi_user_currency) ? L_T.negative : L_T.positive,
                },
              ]}
            />
          </div>
          {v.verdict === 'prepay' && (
            targetIdx !== '' &&
            profile.isLive &&
            profile.user.loans[Number(targetIdx)] ? (
              <ApplyAction
                applied={applied}
                onApply={() => {
                  if (applied || busy || checked !== fingerprint) return;
                  if (JSON.stringify(loadProfileClient().user) !== resultProfileKey) { setErr('Your profile changed. Check again before logging a payment.'); return; }
                  const target = profile.user.loans[Number(targetIdx)];
                  if (loanCurrency !== nativeLoanCurrency(target, profile.user.country)) { setErr('The loan currency was edited. Select the saved loan and check again.'); return; }
                  try {
                  const sched = target.scheduled_emi || '0';
                  const balanceD = new Decimal(loanBalance);
                  const outstandingD = new Decimal(target.outstanding);
                  const fullyClears = balanceD.gte(outstandingD);
                  applyToolResult({
                    loanIndex: Number(targetIdx),
                    kind: fullyClears ? 'closed' : 'paid_extra',
                    amount: fullyClears
                      ? outstandingD.toFixed(2)
                      : String(Number(sched) + Number(loanBalance)),
                    scheduledEmi: sched,
                    note: `NRI prepay — ${formatCurrency(loanBalance, loanCurrency)} to ${target.bank}`,
                    loans: profile.user.loans,
                    country: profile.user.country,
                  });
                  setApplied(true);
                  } catch (e) { setErr((e as Error).message); }
                }}
                label={`I paid it off · log it on the ${loanLabel(profile.user.loans[Number(targetIdx)])}`}
              />
            ) : addBlocker ? (
              <p style={{ marginTop: 14, fontSize: 'var(--fs-dense)', color: L_T.muted, lineHeight: 1.55 }}>
                {addBlocker}
              </p>
            ) : (
              <AddLoanAction
                added={added}
                onAdd={() => {
                  // Saved as a personal loan with a generic lender name
                  // (cross-border loans are often with lenders outside our
                  // lists); amounts stay in the loan's currency, tagged.
                  const r = Number(loanRate) / 12;
                  const n = Number(loanTenure);
                  const p = Number(loanBalance);
                  const emi = r === 0 ? p / n : (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
                  const saved = addLoanToProfile({
                    loan_type: 'personal_loan' as LoanType,
                    bank: `Foreign loan (${loanCurrency})`,
                    outstanding: loanBalance,
                    nominal_rate: loanRate,
                    tenure_months_remaining: Number(loanTenure),
                    scheduled_emi: emi.toFixed(2),
                    ...addInput,
                  });
                  if (saved != null) setAdded(true);
                }}
                label={`Add this ${loanCurrency} loan to my profile`}
              />
            )
          )}
        </LStep>
      )}

      {v && (
        <LMathBlock
          rows={[
            { k: 'the loan', v: pct(loanRate), note: `a year, in ${loanCurrency}` },
            ...(twoCurrencies
              ? [
                  { k: 'exchange rate', v: displayedFx ?? '—', ...(fxFrom ? { note: fxFrom } : {}) },
                  { k: `${loanCurrency} against ${userCurrency}`, v: pct(v.fx_drift_used), note: `a year${manualDrift ? '' : ', the last 20 years’ trend'}; above 0 makes the loan dearer` },
                ]
              : []),
            { k: `the loan, in ${userCurrency}`, v: pct(v.effective_loan_cost_in_user_currency), tone: 'neg' as const },
            { k: 'savings, before tax', v: pct(savingsYield || 0) },
            { k: 'savings, after tax', v: pct(v.user_post_tax_yield), note: `taxed at ${pct(marginalTax || 0)}`, tone: 'pos' as const },
            { k: Number(v.spread) > 0 ? 'prepaying ahead by' : 'saving ahead by', v: pct(Math.abs(Number(v.spread))) },
          ]}
        />
      )}
    </LSteps>
  );
}


/** What the NRI answer leaves out, and the one-time cost of sending the
 *  money (sprint G10: NRI made accurate). Rules: a US tax resident is taxed
 *  on worldwide income, so interest an NRE account earns, tax-free in
 *  India, is still US income (https://www.irs.gov/individuals/international-taxpayers/us-citizens-and-resident-aliens-abroad);
 *  an Indian home loan's interest deduction is the old regime's for a
 *  self-occupied home (Income-tax Act 2025 s.22; 1961 Act s.24(b)). */
function NriNotes({ spread, remitPct, loanCurrency, userCurrency }: { spread: number; remitPct: string; loanCurrency: string; userCurrency: string }) {
  const cost = Number(remitPct) / 100;
  const payback = cost > 0 && spread > 0 ? Math.ceil((cost / spread) * 12) : null;
  return (
    <div style={{ marginTop: 12 }}>
      {loanCurrency !== userCurrency && (
        <LNote style={{ color: L_T.ink }}>
          {!(cost > 0)
            ? 'Sending the money isn’t counted: add what it costs under + MORE.'
            : payback != null
              ? `Sending it costs ${(cost * 100).toFixed(2)}% once; the gap above earns that back in about ${payback} month${payback === 1 ? '' : 's'}.`
              : `Sending it costs ${(cost * 100).toFixed(2)}% once, on top of the gap above.`}
        </LNote>
      )}
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--fs-dense)', lineHeight: 1.7, color: L_T.muted }}>
        <li>The loan&apos;s rate is before any tax break. If you deduct its interest (in India, the old regime&apos;s home-loan deduction, or against rent from a let-out home), it costs you less, and prepaying saves less.</li>
        <li>If you are taxed in the US, interest your savings earn anywhere is US income, including an NRE account in India that is tax-free there. Use your US rate above.</li>
        <li>The exchange-rate trend is the last 20 years&apos;, not a forecast.</li>
      </ul>
      <p style={{ margin: '8px 0 0', fontSize: 'var(--fs-dense)', color: L_T.muted }}>
        Terms: <Term id="remittance_cost" /> · <Term id="fx_drift" /> · <Term id="nre_nro" /> · <Term id="tax_shield" />
      </p>
    </div>
  );
}
