'use client';

/**
 * Profile → Assumptions (roadmap PR D). Every value the app used to
 * hard-code that is really the user's call, with its default beside it.
 * Empty = the default. Saved on the profile, so Plan, Spare cash, Goals
 * and Sell to repay all read the same numbers (lib/assumptions).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AssetType, Country, UserPayload } from '@/lib/api';
import { loadProfileClient, saveProfileClient } from '@/lib/user-store';
import { readEfSplitClient } from '@/lib/ef-split';
import {
  DEFAULT_ASSET_RETURNS,
  DEFAULT_EF_MONTHS,
  DEFAULT_LIQUIDATION_COSTS,
  DEFAULT_PREPAY_HURDLE,
  LIQUIDATION_COST_NOTE,
  cleanMap,
  parseRateInput,
} from '@/lib/assumptions';
import { LBracket, L_T } from '@/components/ledger/primitives';

const TYPE_LABEL: Record<string, string> = {
  savings_balance: 'Savings', fixed_deposit: 'Fixed deposit / CD', equity_stocks: 'Shares', equity_mf: 'Equity funds',
  debt_mf: 'Debt funds', gold_physical: 'Gold', gold_etf: 'Gold ETF', crypto: 'Crypto', sgb: 'Sovereign Gold Bond', real_estate: 'Property', ppf: 'PPF', epf: 'EPF',
  nps: 'NPS', other: 'Other',
};
const pct = (f: string | number | null | undefined) => (f == null || f === '' ? '' : String(Number((Number(f) * 100).toFixed(4))));
const showPct = (f: number) => `${Number((f * 100).toFixed(2))}%`;

export function AssumptionsClient() {
  const router = useRouter();
  const [user, setUser] = useState<UserPayload | null>(null);
  const [hurdle, setHurdle] = useState('');
  const [returns, setReturns] = useState<Record<string, string>>({});
  const [costs, setCosts] = useState<Record<string, string>>({});
  const [efM, setEfM] = useState('');
  const [efAmt, setEfAmt] = useState('');
  const [buffer, setBuffer] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);
  const [split, setSplit] = useState('0.30');

  useEffect(() => {
    const s = loadProfileClient();
    if (!s.isLive) return;
    const u = s.user;
    setUser(u);
    setHurdle(pct(u.prepay_hurdle));
    setReturns(Object.fromEntries(Object.entries(u.asset_returns ?? {}).map(([k, v]) => [k, pct(v)])));
    setCosts(Object.fromEntries(Object.entries(u.liquidation_costs ?? {}).map(([k, v]) => [k, pct(v)])));
    setEfM(u.assumptions?.ef_months ? String(u.assumptions.ef_months) : '');
    setEfAmt(u.assumptions?.ef_save_amount ?? '');
    setBuffer(pct(u.assumptions?.goal_buffer_pct));
    setSplit(readEfSplitClient());
  }, []);

  if (!user) {
    return <p className="muted">Finish setup first: assumptions apply to your saved profile.</p>;
  }
  const country: Country = user.country;
  const sym = country === 'US' ? '$' : '₹';
  const spend = Number(user.fixed_expenses || 0) + Number(user.variable_expenses || 0);

  function save() {
    const errs: Record<string, string> = {};
    const h = parseRateInput(hurdle, 0, 0.2);
    if (!h.ok) errs.hurdle = h.error;
    const b = parseRateInput(buffer, 0, 1);
    if (!b.ok) errs.buffer = b.error;
    const r: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(returns)) {
      const p = parseRateInput(v, -0.5, 1);
      if (p.ok) r[k] = p.value; else errs[`r-${k}`] = p.error;
    }
    const c: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(costs)) {
      const p = parseRateInput(v, 0, 1);
      if (p.ok) c[k] = p.value; else errs[`c-${k}`] = p.error;
    }
    const months = efM.trim() === '' ? null : Number(efM);
    if (months != null && !(Number.isInteger(months) && months >= 1 && months <= 24)) errs.efM = 'Whole months, 1 to 24.';
    const amt = efAmt.trim() === '' ? null : Number(efAmt);
    if (amt != null && !(Number.isFinite(amt) && amt >= 0)) errs.efAmt = 'An amount of zero or more, or empty.';
    setErrors(errs);
    if (Object.keys(errs).length > 0 || !user) return;
    const prevMonths = user.assumptions?.ef_months ?? null;
    const next: UserPayload = {
      ...user,
      prepay_hurdle: h.ok ? h.value : null,
      asset_returns: cleanMap(r),
      liquidation_costs: cleanMap(c),
      assumptions: {
        ef_months: months,
        ef_save_amount: amt != null && amt > 0 ? String(amt) : null,
        goal_buffer_pct: b.ok ? b.value : null,
      },
      // New months of cover: the emergency-fund target follows (months × monthly spending).
      ...(months != null && months !== prevMonths && spend > 0 ? { efund_target: String(Math.round(months * spend)) } : {}),
    };
    const stored = loadProfileClient();
    if (!saveProfileClient({ user: next, marginalRate: stored.marginalRate, creditScore: stored.creditScore })) {
      setSaved('Could not save. Your previous assumptions are still in place.');
      return;
    }
    setUser(next);
    setSaved('Saved. Plan, Spare cash, Goals and Sell to repay now use these.');
    router.refresh();
  }

  const row = (label: string, def: string, input: React.ReactNode, note?: string, err?: string) => (
    // Two columns, the default under the label: three overflowed a phone.
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${L_T.ruleSoft}` }}>
      <span>
        {label}
        {note && <span style={{ display: 'block', fontSize: 11, color: L_T.muted }}>{note}</span>}
        <span style={{ display: 'block', fontSize: 11, color: L_T.muted }}>Default {def}</span>
        {err && <span role="alert" style={{ display: 'block', fontSize: 11, color: L_T.negative }}>{err}</span>}
      </span>
      {input}
    </div>
  );
  const box = (value: string, set: (v: string) => void, label: string, suffix: string, placeholder: string) => (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <input aria-label={label} inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => set(e.target.value)} style={{ width: 72 }} />
      <span style={{ fontSize: 11 }}>{suffix}</span>
      {value !== '' && <button type="button" onClick={() => set('')} style={{ fontSize: 11 }} aria-label={`Reset ${label}`}>RESET</button>}
    </span>
  );
  const types = Object.keys(DEFAULT_ASSET_RETURNS[country]) as AssetType[];
  const costTypes = Object.keys(DEFAULT_LIQUIDATION_COSTS[country]) as AssetType[];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 720 }}>
      <header>
        <div style={{ fontSize: 11, letterSpacing: '0.18em', color: L_T.muted, marginBottom: 10 }}>PROFILE</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>ASSUMPTIONS</h1>
        <p style={{ color: L_T.muted, margin: '8px 0 0', lineHeight: 1.6 }}>
          The numbers the plan assumes for you. Each shows its default; type your own, or leave it empty to keep the default.
        </p>
      </header>

      <section aria-label="Emergency fund">
        <h2 style={{ fontSize: 13, letterSpacing: '0.12em' }}>EMERGENCY FUND</h2>
        {row('Months of cover', `${DEFAULT_EF_MONTHS} months`, box(efM, setEfM, 'Months of cover', 'months', String(DEFAULT_EF_MONTHS)),
          spend > 0 ? `Target = months × your monthly spending (${sym}${Math.round(spend).toLocaleString()})` : undefined, errors.efM)}
        {row('Fixed monthly top-up', `${Math.round(Number(split) * 100)}% of spare cash (Plan slider)`, box(efAmt, setEfAmt, 'Fixed monthly top-up', sym, '—'),
          'A fixed amount each month until the fund is full, instead of a share of spare cash', errors.efAmt)}
      </section>

      <section aria-label="Paying debt or investing">
        <h2 style={{ fontSize: 13, letterSpacing: '0.12em' }}>PAYING DEBT OR INVESTING</h2>
        {row('Prepay margin', showPct(DEFAULT_PREPAY_HURDLE), box(hurdle, setHurdle, 'Prepay margin', '%', pct(DEFAULT_PREPAY_HURDLE)),
          "Extra goes to a loan only if its after-tax rate beats your best savings return by this much", errors.hurdle)}
      </section>

      <section aria-label="Goals">
        <h2 style={{ fontSize: 13, letterSpacing: '0.12em' }}>GOALS</h2>
        {row('Buffer on a new goal', 'by kind (0–25%)', box(buffer, setBuffer, 'Goal buffer', '%', '—'),
          'Added on top of a new goal for surprises; each goal can still change its own', errors.buffer)}
      </section>

      <section aria-label="Expected returns">
        <h2 style={{ fontSize: 13, letterSpacing: '0.12em' }}>EXPECTED RETURNS, A YEAR</h2>
        {types.map((t) => row(TYPE_LABEL[t] ?? t, showPct(DEFAULT_ASSET_RETURNS[country][t] ?? 0.06),
          box(returns[t] ?? '', (v) => setReturns((m) => ({ ...m, [t]: v })), `Return on ${TYPE_LABEL[t] ?? t}`, '%', pct(DEFAULT_ASSET_RETURNS[country][t] ?? 0.06)),
          undefined, errors[`r-${t}`]))}
      </section>

      <section aria-label="Selling costs">
        <h2 style={{ fontSize: 13, letterSpacing: '0.12em' }}>SELLING COSTS</h2>
        {costTypes.map((t) => row(TYPE_LABEL[t] ?? t, showPct(DEFAULT_LIQUIDATION_COSTS[country][t] ?? 0),
          box(costs[t] ?? '', (v) => setCosts((m) => ({ ...m, [t]: v })), `Selling cost on ${TYPE_LABEL[t] ?? t}`, '%', pct(DEFAULT_LIQUIDATION_COSTS[country][t] ?? 0)),
          LIQUIDATION_COST_NOTE[t], errors[`c-${t}`]))}
      </section>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <LBracket onClick={save} label="Save assumptions">SAVE</LBracket>
        <LBracket href="/profile">← PROFILE</LBracket>
        {saved && <span role="status" style={{ fontSize: 12, color: L_T.muted }}>{saved}</span>}
      </div>
    </div>
  );
}
