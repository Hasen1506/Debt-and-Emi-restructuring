'use client';

/**
 * /tax: tax and your loans (sprint G2; grill #7, #10, #20, #31, #32, #77).
 *
 * Brought back as its own page (it was folded into Profile in V5 when it
 * only repeated three rows). It now does what a summary can't:
 *   1. the tax rate the plan uses, whether it's estimated, and a one-tap
 *      confirm (#20), with the income mix it rests on;
 *   2. India: old vs new regime this tax year with the loans counted, the
 *      switching rules for salaried vs business income, and a "planning a
 *      home loan?" what-if for big decisions (#32);
 *   3. each home / education loan's tax inputs: the user's share
 *      (co-borrower, #7), let-out rent, pre-construction interest and its
 *      five instalments, the ₹30k case, the 80E start (#31);
 *   4. India, old regime: unused 80C room a home-loan prepayment can use.
 * Every rule names its section in the Income-tax Act 2025 and the 1961 Act.
 */
import { useMemo, useState, type ReactNode } from 'react';
import Decimal from 'decimal.js';
import type { LoanPayload, UserPayload } from '@/lib/api';
import { formatINR } from '@/lib/api';
import { useStoredProfile } from '@/lib/use-profile';
import { loadProfileClient, saveProfileClient } from '@/lib/user-store';
import { countryMonthKey } from '@/lib/today';
import { compareRegimes, firstYearSplit, switchRuleText, type RegimeComparison } from '@/lib/regime-compare';
import { MIX_LABEL, readIncome, regimeInputsFromUser, taxRateStatus } from '@/lib/tax-profile';
import { loanTaxLine, nextYearSplit, preConstructionInstalment, sec80cRoom, sectionLabel, taxShare } from '@/lib/india-tax-loans';
import { LBracket, LChip, LChipRow, LSectionHeader, L_T } from '@/components/ledger/primitives';
import TAX from '@/lib/tax-tables.json';

const rupees = (v: Decimal.Value) => formatINR(new Decimal(v).toDecimalPlaces(0).toString());
const pct = (v: Decimal.Value) => `${new Decimal(v).mul(100).toFixed(1)}%`;

export function TaxPage() {
  const profile = useStoredProfile();
  const user = profile.user;
  const month = countryMonthKey(user.country);
  const isIN = user.country === 'IN';
  const [said, setSaid] = useState('');

  function save(patch: (u: UserPayload) => UserPayload, message: string) {
    const stored = loadProfileClient();
    const ok = saveProfileClient({ ...stored, user: patch(stored.user) });
    setSaid(ok ? message : 'That didn’t save. Nothing was changed.');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 820 }}>
      <header>
        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 10 }}>PROFILE · TAX</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, textTransform: 'uppercase', lineHeight: 1.25 }}>Tax and your loans</h1>
        <p style={{ color: L_T.inkSoft, fontSize: 13, margin: '8px 0 0', lineHeight: 1.6 }}>
          {isIN
            ? 'What your loans do for your tax, and which regime that makes cheaper this year. These are estimates from what you entered, not a tax return: check them against your Form 16 or with whoever files for you.'
            : 'The tax details the plan uses for your mortgage and student-loan interest.'}{' '}
          <LBracket href="/profile">← WHOLE PROFILE</LBracket>
        </p>
        {isIN && (
          <p style={{ color: L_T.muted, fontSize: 11, margin: '6px 0 0', lineHeight: 1.6 }}>
            Law: {TAX.in.law_as_of}. Section numbers are given both ways: the 1961 one you know (24(b), 80C, 80E) and the Income-tax Act 2025 one that replaced it on 1 April 2026.
          </p>
        )}
      </header>

      <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 12, color: L_T.positive, minHeight: said ? undefined : 0 }}>
        {said}
      </p>

      <RateSection user={user} marginalRate={profile.marginalRate} onConfirm={() => save((u) => ({ ...u, tax_rate_confirmed: true }), 'Saved: your tax rate is confirmed.')} />

      {isIN && <RegimeSection user={user} month={month} onUse={(r) => save((u) => ({ ...u, tax_regime: r }), `Saved: the plan now uses the ${r} regime.`)} />}

      {isIN && <LoansSection user={user} month={month} onSave={(next, msg) => save((u) => ({ ...u, loans: next(u.loans) }), msg)} />}

      {isIN && <EightyCSection user={user} month={month} marginalRate={profile.marginalRate} />}

      {isIN && <WhyFive />}

      {isIN && <Sources />}
    </div>
  );
}

// ─── 1. The rate ─────────────────────────────────────────────────────────────

function RateSection({ user, marginalRate, onConfirm }: { user: UserPayload; marginalRate?: string; onConfirm: () => void }) {
  const status = taxRateStatus(user);
  const income = readIncome(user);
  const rate = Number(marginalRate || 0);
  return (
    <section aria-labelledby="tx-rate">
      <LSectionHeader step={1}>
        <span id="tx-rate">YOUR TAX RATE</span>
      </LSectionHeader>
      <Rows
        rows={[
          ['Country', user.country === 'IN' ? 'India' : 'USA'],
          ...(user.country === 'US'
            ? [['Filing as', ({ single: 'Single', mfj: 'Married, filing jointly', hoh: 'Head of household' } as Record<string, string>)[user.filing_status ?? 'single']] as [string, ReactNode]]
            : []),
          [`Tax on your next ${user.country === 'IN' ? 'rupee' : 'dollar'}`, <>{pct(rate)}{status === 'estimated' && <Muted> · estimate</Muted>}</>],
          ['How you earn', MIX_LABEL[income.mix]],
          ...(user.country === 'IN' ? [['Regime the plan uses', user.tax_regime === 'old' ? 'Old regime' : 'New regime (the default)'] as [string, ReactNode]] : []),
        ]}
      />
      <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.6, color: L_T.inkSoft }}>
        This rate decides how much a loan’s tax break is worth, and so which loan the plan pays first and whether paying early beats investing.{' '}
        {income.mix === 'salary_plus_business' &&
          'With salary and a side business, the standard deduction comes off the salary only, and the business income means switching regime is a once-only choice (below). '}
        {income.mix === 'business' && 'With business income only, there is no standard deduction, and switching regime is a once-only choice (below). '}
      </p>
      {status === 'estimated' && (
        <div style={{ marginTop: 10, padding: '10px 12px', border: `1px solid ${L_T.ink}`, background: L_T.highlightSoft }}>
          <p style={{ margin: '0 0 8px', fontSize: 12, lineHeight: 1.6 }}>
            {pct(rate)} is worked out from your take-home pay, so it’s a guess: it doesn’t know your PF, insurance or other income. Is {pct(rate)} right?
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <LBracket accent onClick={onConfirm} label={`Yes, ${pct(rate)} is right`}>YES, {pct(rate)} IS RIGHT</LBracket>
            <LBracket href="/profile?step=income">ENTER GROSS PAY INSTEAD</LBracket>
          </div>
        </div>
      )}
      {status === 'confirmed' && <p style={{ margin: '8px 0 0', fontSize: 12, color: L_T.muted }}>You confirmed this rate. Entering gross pay in Profile would make it exact.</p>}
    </section>
  );
}

// ─── 2. Old or new ───────────────────────────────────────────────────────────

function RegimeSection({ user, month, onUse }: { user: UserPayload; month: string; onUse: (r: 'old' | 'new') => void }) {
  const { inputs, hasBusiness, assumptions } = useMemo(() => regimeInputsFromUser(user, month), [user, month]);
  const income = readIncome(user);
  const cmp = useMemo(() => compareRegimes(inputs, hasBusiness), [inputs, hasBusiness]);
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('8.5');
  const [years, setYears] = useState('20');
  const whatIf = useMemo<RegimeComparison | null>(() => {
    const a = Number(amount);
    if (!(a > 0) || !(Number(rate) >= 0) || !(Number(years) > 0)) return null;
    const y = firstYearSplit(a, new Decimal(rate || 0).div(100), Math.round(Number(years) * 12));
    return compareRegimes({ ...inputs, homeLoans: [...(inputs.homeLoans ?? []), { interest: y.interest, principal: y.principal }] }, hasBusiness);
  }, [amount, rate, years, inputs, hasBusiness]);

  const current = user.tax_regime === 'old' ? 'old' : 'new';
  return (
    <section aria-labelledby="tx-regime">
      <LSectionHeader step={2}>
        <span id="tx-regime">OLD OR NEW REGIME, THIS TAX YEAR</span>
      </LSectionHeader>
      {income.source === 'none' ? (
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
          Add your gross salary or business income in Profile and this compares the two regimes with your loans counted.{' '}
          <LBracket href="/profile?step=income">ADD GROSS INCOME</LBracket>
        </p>
      ) : (
        <>
          <Rows
            rows={[
              ['', <span key="h" style={{ display: 'flex', gap: 24 }}><b style={{ minWidth: 110 }}>Old regime</b><b>New regime</b></span>],
              ['Income tax is charged on', <Pair key="t" a={cmp.old.taxable} b={cmp.new.taxable} />],
              ['Tax for the year', <Pair key="x" a={cmp.old.tax} b={cmp.new.tax} />],
              ['Your loans take off', <Pair key="l" a={cmp.old.loanDeductions} b={cmp.new.loanDeductions} suffix=" of income" />],
            ]}
          />
          <p style={{ margin: '10px 0 0', fontSize: 13, lineHeight: 1.6, fontWeight: 600 }}>
            {cmp.better === 'same'
              ? 'Both regimes come to the same tax this year.'
              : cmp.better === 'old'
                ? `The old regime is cheaper by ${rupees(cmp.oldSaves)} this year.`
                : `The new regime is cheaper by ${rupees(cmp.oldSaves.neg())} this year.`}{' '}
            {cmp.loansWorthInOld.gt(0) && `Your loans are worth ${rupees(cmp.loansWorthInOld)} of tax in the old regime.`}
          </p>
          {cmp.better === 'new' && cmp.extraDeductionsForOldToWin != null && (
            <p style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.6, color: L_T.inkSoft }}>
              The old regime would win with about {rupees(cmp.extraDeductionsForOldToWin)} more of old-regime deductions a year (80C, 80D, NPS, home-loan interest).
            </p>
          )}
          {cmp.better !== 'same' && cmp.better !== current && (
            <div style={{ marginTop: 8 }}>
              <LBracket accent onClick={() => onUse(cmp.better as 'old' | 'new')}>
                PLAN WITH THE {cmp.better.toUpperCase()} REGIME
              </LBracket>
              <span style={{ fontSize: 11, color: L_T.muted, marginLeft: 8 }}>This changes the plan’s maths only. You choose the regime when you file your return.</span>
            </div>
          )}
          <p style={{ margin: '12px 0 0', fontSize: 12, lineHeight: 1.6 }}>
            <b>Switching.</b> {switchRuleText(cmp.switchRule)} (s.202(4) of the Income-tax Act 2025; 1961: s.115BAC(6).)
          </p>
          {assumptions.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 11, color: L_T.muted, lineHeight: 1.6 }}>
              {assumptions.map((a) => <li key={a}>{a}</li>)}
            </ul>
          )}
          <p style={{ margin: '6px 0 0', fontSize: 11, color: L_T.muted, lineHeight: 1.6 }}>
            Left out: employer NPS (allowed in both regimes), capital gains, agricultural income, and carrying a house-property loss forward to later years.
          </p>

          <div style={{ marginTop: 16, paddingTop: 10, borderTop: `1px solid ${L_T.ruleSoft}` }}>
            <h3 style={{ margin: '0 0 6px', fontSize: 12, letterSpacing: '0.1em' }}>BEFORE A BIG DECISION: PLANNING A HOME LOAN?</h3>
            <p style={{ margin: '0 0 8px', fontSize: 12, lineHeight: 1.6, color: L_T.inkSoft }}>
              A self-occupied home loan is the usual reason the old regime starts to win: its interest (up to ₹2L) and principal (inside ₹1.5L of 80C) count only there. See its first year.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <NumIn label="Loan amount (₹)" value={amount} onChange={setAmount} />
              <NumIn label="Rate (% a year)" value={rate} onChange={setRate} />
              <NumIn label="Years" value={years} onChange={setYears} />
            </div>
            {whatIf && (
              <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.6 }}>
                With that loan: old regime {rupees(whatIf.old.tax)}, new regime {rupees(whatIf.new.tax)}.{' '}
                {whatIf.better === 'old'
                  ? `The old regime would be cheaper by ${rupees(whatIf.oldSaves)}.`
                  : whatIf.better === 'new'
                    ? `The new regime would still be cheaper, by ${rupees(whatIf.oldSaves.neg())}.`
                    : 'They would come to the same.'}
                {whatIf.switchRule === 'business_once' && whatIf.better === 'old' && ' With business income, leaving the new regime is close to permanent: weigh the years after the loan’s early, interest-heavy ones too.'}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Pair({ a, b, suffix = '' }: { a: Decimal; b: Decimal; suffix?: string }) {
  return (
    <span style={{ display: 'flex', gap: 24 }}>
      <span style={{ minWidth: 110 }}>{rupees(a)}{suffix && <Muted>{suffix}</Muted>}</span>
      <span>{rupees(b)}</span>
    </span>
  );
}

// ─── 3. Each loan ────────────────────────────────────────────────────────────

function LoansSection({ user, month, onSave }: { user: UserPayload; month: string; onSave: (next: (loans: LoanPayload[]) => LoanPayload[], msg: string) => void }) {
  const rows = user.loans
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => (l.loan_type === 'home_loan' || l.loan_type === 'education_loan') && (l.currency ?? 'INR') === 'INR');
  const regime = user.tax_regime === 'old' ? 'old' : 'new';
  return (
    <section aria-labelledby="tx-loans">
      <LSectionHeader step={3}>
        <span id="tx-loans">EACH LOAN AND TAX</span>
      </LSectionHeader>
      {rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
          Only home and education loans lower Indian income tax. Personal loans, car loans, gold loans and cards don’t, in either regime (a loan used for a business is a business expense: that’s for your accounts, not this page).
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {rows.map(({ l, i }) => (
            <LoanTaxCard key={l.id ?? i} loan={l} regime={regime} month={month} onSave={(patch, msg) => onSave((loans) => loans.map((x, k) => (x.id && l.id ? x.id === l.id : k === i) ? { ...x, ...patch } : x), msg)} />
          ))}
        </div>
      )}
    </section>
  );
}

function LoanTaxCard({ loan, regime, month, onSave }: { loan: LoanPayload; regime: 'old' | 'new'; month: string; onSave: (patch: Partial<LoanPayload>, msg: string) => void }) {
  const isHome = loan.loan_type === 'home_loan';
  const [share, setShare] = useState(taxShare(loan).mul(100).toDecimalPlaces(0).toString());
  const [use, setUse] = useState<'self_occupied' | 'let_out'>(loan.property_use === 'let_out' ? 'let_out' : 'self_occupied');
  const [rent, setRent] = useState(loan.annual_rent ?? '');
  const [pre, setPre] = useState(loan.pre_construction_interest_total ?? '');
  const [done, setDone] = useState(loan.construction_completed ?? '');
  const [fullCap, setFullCap] = useState(loan.sec24_full_cap !== false);
  const [eligible, setEligible] = useState(loan.principal_80c_eligible !== false);
  const [eduStart, setEduStart] = useState(loan.edu_interest_start ?? '');
  const name = loan.bank || (isHome ? 'Home loan' : 'Education loan');
  const year = nextYearSplit(loan);
  const draft: LoanPayload = {
    ...loan,
    tax_share: String(Math.max(0, Math.min(100, Number(share) || 0)) / 100),
    property_use: isHome ? use : loan.property_use,
    annual_rent: rent || undefined,
    pre_construction_interest_total: pre || undefined,
    construction_completed: done || undefined,
    sec24_full_cap: fullCap ? undefined : false,
    principal_80c_eligible: eligible ? undefined : false,
    edu_interest_start: eduStart || undefined,
  };
  const inst = preConstructionInstalment(draft, month);
  const valid = Number(share) >= 0 && Number(share) <= 100 && (!done || /^\d{4}-(0[1-9]|1[0-2])$/.test(done)) && (!eduStart || /^\d{4}-(0[1-9]|1[0-2])$/.test(eduStart));

  function submit() {
    const patch: Partial<LoanPayload> = {
      tax_share: draft.tax_share === '1' ? undefined : draft.tax_share,
      edu_interest_start: draft.edu_interest_start,
    };
    if (isHome) Object.assign(patch, {
      property_use: draft.property_use,
      annual_rent: use === 'let_out' ? draft.annual_rent : undefined,
      pre_construction_interest_total: draft.pre_construction_interest_total,
      construction_completed: draft.construction_completed,
      sec24_full_cap: draft.sec24_full_cap,
      principal_80c_eligible: draft.principal_80c_eligible,
    });
    onSave(patch, `Saved the tax details for ${name}.`);
  }

  return (
    <div style={{ border: `1px solid ${L_T.ruleSoft}`, padding: '10px 12px', background: L_T.paper }}>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{name}</div>
      <p style={{ margin: '4px 0 8px', fontSize: 12, lineHeight: 1.6, color: L_T.inkSoft }}>{loanTaxLine(draft, regime, month)}</p>
      <p style={{ margin: '0 0 8px', fontSize: 11, color: L_T.muted }}>
        Next 12 EMIs: about {rupees(year.interest)} interest and {rupees(year.principal)} principal (whole loan).
      </p>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <NumIn
          label="Your share for tax (%)"
          value={share}
          onChange={setShare}
          hint={isHome
            ? 'Co-borrower who co-owns the home: your part of the interest and principal. Each co-owner claims their own share, each with their own ₹2L and ₹1.5L limits. If they pay part of the EMI, enter only your part of the EMI on the loan.'
            : 'The part of the interest you pay. 80E goes to whoever took the loan and pays it from their taxable income.'}
        />
        {isHome && (
          <LChipRow label="The home is">
            <LChip on={use === 'self_occupied'} onClick={() => setUse('self_occupied')}>Lived in</LChip>
            <LChip on={use === 'let_out'} onClick={() => setUse('let_out')}>Let out</LChip>
          </LChipRow>
        )}
        {isHome && use === 'let_out' && <NumIn label="Rent a year, whole house (₹)" value={rent} onChange={setRent} />}
        {!isHome && <TextIn label="First paid interest (YYYY-MM)" value={eduStart} onChange={setEduStart} hint="The 80E window is that April–March tax year and the next seven." />}
      </div>
      {isHome && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12 }}>Bought under construction, or a non-bank lender?</summary>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, alignItems: 'flex-end' }}>
            <NumIn label="Interest paid before you got the house (₹, total)" value={pre} onChange={setPre} hint="Pre-EMI / pre-construction interest. It is claimed in five equal parts, from the year the house was finished." />
            <TextIn label="House finished (YYYY-MM)" value={done} onChange={setDone} />
            <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={fullCap} onChange={(e) => setFullCap(e.target.checked)} />
              Finished within 5 years of the end of the tax year I borrowed
            </label>
            <label style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={eligible} onChange={(e) => setEligible(e.target.checked)} />
              From a bank, housing finance company, LIC, NHB or my employer (for the 80C principal)
            </label>
          </div>
          {inst.gt(0) && <p style={{ margin: '6px 0 0', fontSize: 12 }}>This tax year’s part: {rupees(inst)} (one of five), counted inside the ₹2L limit.</p>}
          {!fullCap && <p style={{ margin: '6px 0 0', fontSize: 12 }}>Finished late: the limit on a lived-in home’s interest is ₹30,000, not ₹2L ({sectionLabel('24(b)')}).</p>}
        </details>
      )}
      <div style={{ marginTop: 8 }}>
        <LBracket accent onClick={valid ? submit : undefined} disabled={!valid} label={`Save tax details for ${name}`}>SAVE</LBracket>
        {!valid && <span style={{ fontSize: 11, color: L_T.negative, marginLeft: 8 }}>Share is 0–100; months are YYYY-MM.</span>}
      </div>
    </div>
  );
}

// ─── 4. 80C room ─────────────────────────────────────────────────────────────

function EightyCSection({ user, month, marginalRate }: { user: UserPayload; month: string; marginalRate?: string }) {
  if (user.tax_regime !== 'old') return null;
  const homes = user.loans.filter((l) => l.loan_type === 'home_loan' && (l.currency ?? 'INR') === 'INR' && l.principal_80c_eligible !== false);
  if (homes.length === 0) return null;
  const principal = homes.reduce((s, l) => s.add(nextYearSplit(l).principal.mul(taxShare(l))), new Decimal(0));
  const room = sec80cRoom(user.deductions?.sec_80c_annual ?? 0, principal);
  void month;
  return (
    <section aria-labelledby="tx-80c">
      <LSectionHeader>
        <span id="tx-80c">80C ROOM A PREPAYMENT CAN USE</span>
      </LSectionHeader>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
        Your scheduled home-loan principal this year is about {rupees(principal)} (your share). With your other 80C items that leaves{' '}
        <b>{rupees(room)}</b> of the ₹1.5L limit ({sectionLabel('80C')}).{' '}
        {room.gt(0)
          ? `Prepaying up to ${rupees(room)} of home-loan principal this year also lowers your tax by about ${rupees(room.mul(Number(marginalRate || 0)))}, once.`
          : 'A prepayment won’t lower your tax this year: the limit is already used.'}
      </p>
      <p style={{ margin: '6px 0 0', fontSize: 11, color: L_T.muted, lineHeight: 1.6 }}>
        If you sell the house within 5 years of the end of the tax year you got possession, the principal deductions already taken are added back to that year’s income (Schedule XV para 4).
      </p>
    </section>
  );
}

// ─── 5. Explainers and sources ───────────────────────────────────────────────

function WhyFive() {
  return (
    <section aria-labelledby="tx-why5">
      <LSectionHeader>
        <span id="tx-why5">WHY FIVE INSTALMENTS?</span>
      </LSectionHeader>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
        Interest you pay while the house is being built (often called pre-EMI) has no house to belong to yet, so the law doesn’t let you claim it in the years you pay it. Instead, all of it is added up and claimed in five equal parts: in the tax year the house is finished or bought, and the four years after (s.22(1)(c) of the Income-tax Act 2025; the Explanation to s.24(b) of the 1961 Act). From 1 April 2026 those parts count inside the same ₹2L yearly limit as the year’s own interest for a home you live in, so a big pre-EMI bill doesn’t raise the limit, it uses it up.
      </p>
      <p style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.6 }}>
        <b>Is the tax break old-regime only?</b> For a home you live in, and for education loans: yes, the new regime allows neither. For a let-out home, the interest comes off its rent in both regimes; only the old regime lets a loss beyond the rent (up to ₹2L) lower your salary’s tax.
      </p>
    </section>
  );
}

function Sources() {
  return (
    <section aria-labelledby="tx-src">
      <LSectionHeader>
        <span id="tx-src">WHERE THESE RULES COME FROM</span>
      </LSectionHeader>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 11, lineHeight: 1.7, color: L_T.inkSoft }}>
        <li>
          Income-tax Act, 2025 as amended by the Finance Act, 2026: s.22 (house property), s.24 (co-owners), s.109 (set-off), s.123 + Schedule XV (80C), s.129 (80E), s.156 (rebate), s.202 (new regime).{' '}
          <a href={TAX.in.law_source} rel="noreferrer" target="_blank" style={{ color: L_T.accent, textDecoration: 'underline' }}>Income Tax Department</a>
        </li>
        <li>
          Slab rates and surcharge for tax year 2026-27: Finance Act, 2026, First Schedule, Part I-B.{' '}
          <a href={TAX.in.rates_source} rel="noreferrer" target="_blank" style={{ color: L_T.accent, textDecoration: 'underline' }}>Income Tax Department</a>
        </li>
        <li>Read on 12 Oct 2026. Tax rules change with each Budget; the app’s figures are checked against the Act each year.</li>
      </ul>
    </section>
  );
}

// ─── Small parts ─────────────────────────────────────────────────────────────

function Rows({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, max-content) 1fr', gap: '6px 16px', margin: 0, fontSize: 13 }}>
      {rows.map(([k, v], n) => (
        <div key={k || n} style={{ display: 'contents' }}>
          <dt style={{ color: L_T.muted }}>{k}</dt>
          <dd style={{ margin: 0 }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span style={{ color: L_T.muted }}>{children}</span>;
}

function NumIn({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: L_T.muted, maxWidth: 260 }}>
      {label}
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        style={{ fontFamily: 'inherit', fontSize: 13, padding: '6px 8px', border: `1px solid ${L_T.ink}`, background: L_T.paper, color: L_T.ink }}
      />
      {hint && <span style={{ fontSize: 10, lineHeight: 1.5 }}>{hint}</span>}
    </label>
  );
}

function TextIn({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: L_T.muted, maxWidth: 260 }}>
      {label}
      <input
        value={value}
        placeholder="2024-07"
        onChange={(e) => onChange(e.target.value.trim())}
        style={{ fontFamily: 'inherit', fontSize: 13, padding: '6px 8px', border: `1px solid ${L_T.ink}`, background: L_T.paper, color: L_T.ink }}
      />
      {hint && <span style={{ fontSize: 10, lineHeight: 1.5 }}>{hint}</span>}
    </label>
  );
}
