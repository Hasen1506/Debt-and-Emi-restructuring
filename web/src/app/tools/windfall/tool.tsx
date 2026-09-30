'use client';

/**
 * Spare cash — one answer for "I have money I could use": a bonus, a tax
 * refund, or savings sitting idle. (Windfall and Cash Yield used to answer
 * halves of this with different rules.)
 *
 *   1. The emergency fund gets the same share the plan gives it (the /plan
 *      split slider), up to the gap, and we say where to park that share.
 *   2. The rest goes where the engine says: the next loan in the plan's
 *      payoff order, or an investment when that beats every loan.
 */

import { useId, useState } from 'react';
import Decimal from 'decimal.js';
import {
  api,
  formatCurrency,
  type CashYieldResponse,
  type ScoreImpactResponse,
  type WindfallResponse,
} from '@/lib/api';
import { useCurrentProfile as useStoredProfile } from '@/lib/use-profile';
import { readStrategyClient } from '@/lib/strategy';
import { readEfSplitClient } from '@/lib/ef-split';
import { useFormErrors } from '@/lib/form-errors';
import { allocateCash, type CashFunding } from '@/lib/cash-allocation';
import { commitCashChange } from '@/lib/commit-cash-change';
import { readCashEventsClient } from '@/lib/cash-events';
import { addActivityEntry, readActivityClient } from '@/lib/activity';
import { loanToUser } from '@/lib/currency';
import { localIsoDate } from '@/lib/today';
import { loadProfileClient } from '@/lib/user-store';
import { userDefaultCurrency } from '@/lib/currency';
import {
  LToolInput,
  LToolVerdict,
  LToolMath,
  LAllocationBar,
} from '@/components/ledger/LToolShell';
import { LBracket, L_T } from '@/components/ledger/primitives';
import { fitColumns } from '@/lib/grid';

interface Outcome {
  total: Decimal;
  ef: Decimal;
  rest: Decimal;
  gapAfter: Decimal;
  w: WindfallResponse | null;
  cy: CashYieldResponse | null;
  id: string;
  profileKey: string;
  targetId?: string;
}

const LOAN_WORDS: Record<string, string> = {
  credit_card: 'credit card',
  personal_loan: 'personal loan',
  home_loan: 'home loan',
  auto_loan: 'car loan',
  education_loan: 'education loan',
  gold_loan: 'gold loan',
  bnpl: 'BNPL',
};

export function WindfallTool() {
  const profile = useStoredProfile();
  const country = profile.user.country;
  const ccy = userDefaultCurrency(country);
  const fmt = (v: string | number | Decimal) => formatCurrency(v.toString(), ccy);
  const [amount, setAmount] = useState('');
  const [source,setSource] = useState<CashFunding>('external');
  const [accountName,setAccountName] = useState('');
  // Percent, as typed. Typical savings-account rates as the default.
  const [earning, setEarning] = useState(country === 'IN' ? '2.5' : '0.5');
  const [resultOut, setOut] = useState<Outcome | null>(null);
  const [impact, setImpact] = useState<ScoreImpactResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const { err, setErr, clear, fail, at } = useFormErrors();
  const [applied, setApplied] = useState(false);

  const fingerprint = JSON.stringify([amount,earning,source,accountName]);
  const [checked,setChecked] = useState('');
  const out = checked === fingerprint ? resultOut : null;
  const eligibleAccounts = (profile.user.cash_accounts ?? []).filter(a => a.kind !== 'fd' && (!a.currency || a.currency === ccy));
  async function check(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!amount.trim() || !(n > 0)) {
      setErr('Enter how much spare cash you have.');
      return;
    }
    const earningPct = Number(earning.replace('%', '') || '0');
    if (!(earningPct >= 0 && earningPct < 100)) {
      setErr('Enter what the cash earns now as a percent, e.g. 2.5.');
      return;
    }
    setOut(null);
    setBusy(true);
    clear();
    setImpact(null);
    setApplied(false);
    try {
      const requestProfileKey = JSON.stringify(loadProfileClient().user);
      const requestActivityKey = document.cookie.match(/(?:^|; )finoptima_activity_deltas=([^;]*)/)?.[1] ?? '';
      const total = new Decimal(amount);
      const gap = Decimal.max(
        new Decimal(0),
        new Decimal(profile.user.efund_target || 0).minus(profile.user.efund_balance || 0),
      );
      const split = new Decimal(readEfSplitClient());
      const ef = gap.gt(0) ? Decimal.min(gap, total.mul(split)) : new Decimal(0);
      const rest = total.minus(ef);
      const [w, cy] = await Promise.all([
        rest.gt(0)
          ? api.windfall({
              amount: rest.toFixed(2),
              user: profile.user,
              marginal_rate: profile.marginalRate,
              // The payoff order chosen on /plan, not always avalanche.
              strategy: readStrategyClient(),
            })
          : Promise.resolve(null),
        ef.gt(0)
          ? api.cashYield({
              idle_balance: ef.toFixed(2),
              current_yield: (earningPct / 100).toFixed(4),
              country,
            })
          : Promise.resolve(null),
      ]);
      setOut({ total, ef, rest, gapAfter: gap.minus(ef), w, cy, id:crypto.randomUUID(),
        profileKey:requestProfileKey + requestActivityKey, targetId:w?.loan_index != null ? profile.user.loans[w.loan_index]?.id : undefined });
      setChecked(fingerprint);

      // Paying down a card lowers utilisation: estimate the score bump
      // for the card the money actually goes to.
      const target = w && !w.invest_instead && w.loan_index != null
        ? profile.user.loans[w.loan_index]
        : null;
      if (target?.loan_type === 'credit_card' && profile.creditScore != null) {
        const bal = new Decimal(target.outstanding);
        const limit = bal.div('0.7');
        setImpact(
          await api.scoreImpact({
            action: 'utilisation_drop',
            current_score: profile.creditScore,
            country,
            utilisation_from: bal.div(limit).toFixed(4),
            utilisation_to: Decimal.max(bal.minus(new Decimal(w!.amount).minus(w!.fee ?? 0).div(loanToUser(1,target,country,profile.user.fx_to_user_currency)!)), 0).div(limit).toFixed(4),
          }),
        );
      }
    } catch (e) {
      fail(e, { amount: 'amount', idle_balance: 'amount', current_yield: 'earning' });
    } finally {
      setBusy(false);
    }
  }

  function logIt() {
    if (!out || applied || busy || checked !== fingerprint) return;
    try {
      const stored = loadProfileClient();
      const cash = readCashEventsClient();
      if (cash.transfers?.some(t => t.id === out.id)) {setApplied(true);return;}
      const activityKey = document.cookie.match(/(?:^|; )finoptima_activity_deltas=([^;]*)/)?.[1] ?? '';
      if (JSON.stringify(stored.user) + activityKey !== out.profileKey) throw new Error('Your profile or payments changed. Run the cash check again before logging it.');
      const w = out.w;
      const debt = w && !w.invest_instead && w.loan_index != null ? w.amount : '0';
      const investment = w?.invest_instead ? w.amount : '0';
      const date = localIsoDate(new Date());
      const user = allocateCash(stored.user,{total:out.total.toFixed(2),ef:out.ef.toFixed(2),debt,investment,
        source,accountName,investmentName:w?.investment_name ?? 'Spare cash investment',date});
      let entries = readActivityClient();
      if (Number(debt)>0 && w?.loan_index != null) {
        const index = out.targetId ? stored.user.loans.findIndex(l=>l.id===out.targetId) : w.loan_index;
        const loan = stored.user.loans[index];
        if (!loan) throw new Error('The target loan was removed. Run the check again.');
        const fx = loanToUser(1,loan,country,stored.user.fx_to_user_currency);
        if (fx == null) throw new Error('Save the loan exchange rate first.');
        const principal = new Decimal(debt).minus(w.fee ?? 0).div(fx);
        entries = addActivityEntry(entries,{loanIndex:index,loanId:loan.id,kind:'paid_extra',date,
          amount:principal.toFixed(2),scheduledEmi:'0',source:source === 'account' ? 'spare-cash-account' : 'spare-cash-external',
          cashDebited:source === 'account' ? debt : '0',
          note:`Spare cash — ${fmt(debt)} to ${loan.bank}, fee ${fmt(w.fee ?? 0)}; funded by ${source === 'account' ? accountName || 'savings' : 'new external cash'}`},stored.user.loans);
      }
      const next = {...cash,transfers:[...(cash.transfers ?? []),{id:out.id,date,amount:out.total.toFixed(2),source,accountName,
        note:`Debt ${debt}; EF ${out.ef.toFixed(2)}; investment ${investment}; remaining cash ${out.total.minus(debt).minus(investment).minus(out.ef).toFixed(2)}`} ]};
      commitCashChange(stored,user,entries,next);
      setApplied(true);
    } catch(e) {setErr((e as Error).message);}
  }

  const w = out?.w ?? null;
  const target = w && !w.invest_instead && w.loan_index != null ? profile.user.loans[w.loan_index] : null;
  // No loan can take it now (a lock-in, or a fee above the saving) and
  // investing didn't win either: the money stays put.
  const hold = !!w && !w.invest_instead && w.loan_index == null;
  const fee = w ? Number(w.fee ?? 0) : 0;
  const targetName = target
    ? `${target.bank} ${LOAN_WORDS[target.loan_type] ?? target.loan_type}`
    : w?.investment_name ?? '';
  const parts: string[] = [];
  if (out && w && out.rest.gt(0)) {
    parts.push(
      hold
        ? `${fmt(w.leftover)} → KEEP IN SAVINGS`
        : `${fmt(w.amount)} → ${w.invest_instead ? `INVEST IN ${targetName}` : targetName}`.toUpperCase(),
    );
  }
  if (out && out.ef.gt(0)) parts.push(`${fmt(out.ef)} → EMERGENCY FUND`);
  const leftover = w && !hold ? Number(w.leftover) : 0;

  return (
    <>
      {!profile.isLive && (
        <div style={{ fontSize: 11, color: L_T.muted, letterSpacing: '0.08em', padding: '6px 0' }}>
          $ DEMO PROFILE · <a href="/onboarding">[SETUP →]</a>
        </div>
      )}
      <LToolInput>
        <form
          onSubmit={check}
          style={{ display: 'grid', gap: 14, gridTemplateColumns: fitColumns(2, 220) }}
        >
          <LToolField
            label="SPARE CASH"
            value={amount}
            onChange={setAmount}
            hint="A bonus, refund, or savings beyond your emergency fund. After tax."
            error={at('amount')}
          />
          <LToolField
            label="EARNING NOW (%)"
            value={earning}
            onChange={setEarning}
            hint="What it earns where it sits today, e.g. 2.5 for a savings account."
            error={at('earning')}
          />
          <label style={{fontSize:12}}>Funding source
            <select aria-label="Funding source" value={source} onChange={e=>setSource(e.target.value as CashFunding)}>
              <option value="external">New bonus / refund / gift (not yet in balances)</option>
              <option value="account">Existing savings / cash account</option>
            </select>
          </label>
          {source === 'account' && eligibleAccounts.length > 0 && <label style={{fontSize:12}}>Pay from
            <select aria-label="Pay from" value={accountName} onChange={e=>setAccountName(e.target.value)}>
              <option value="">Choose an account</option>
              {eligibleAccounts.map(a=><option key={a.name} value={a.name}>{a.name} · {fmt(a.balance)}</option>)}
            </select>
          </label>}
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="submit"
              disabled={busy}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                padding: '8px 14px',
                background: L_T.ink,
                color: L_T.paper,
                border: `1px solid ${L_T.ink}`,
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              {busy ? '[ WORKING… ]' : '[ WHERE SHOULD IT GO? → ]'}
            </button>
            {err && <span role="alert" style={{ color: L_T.negative, fontSize: 11 }}>{err}</span>}
          </div>
        </form>
      </LToolInput>

      {out && (
        <LToolVerdict
          eyebrow={
            w
              ? w.invest_instead
                ? 'INVEST · NO LOAN BEATS IT'
                : hold
                  ? 'KEEP IT · NO LOAN CAN TAKE IT NOW'
                  : 'PAY DOWN DEBT'
              : 'EMERGENCY FUND FIRST'
          }
          headline={parts.join(' · ')}
          visual={
            <LAllocationBar
              segments={[
                {
                  label: w?.invest_instead ? 'INVEST' : hold ? 'SAVINGS' : 'DEBT',
                  pct: out.total.gt(0) ? out.rest.div(out.total).toNumber() : 0,
                  tone: 'accent' as const,
                },
                {
                  label: 'EMERGENCY FUND',
                  pct: out.total.gt(0) ? out.ef.div(out.total).toNumber() : 0,
                  tone: 'pos' as const,
                },
              ].filter((sgm) => sgm.pct > 0)}
            />
          }
          kpi={[
            {
              l: w?.invest_instead ? 'INTEREST GIVEN UP' : fee > 0 ? 'SAVED AFTER FEE' : 'INTEREST AVOIDED',
              v: w && !hold ? fmt(fee > 0 ? (w.net_benefit ?? w.interest_avoided) : w.interest_avoided) : '—',
              s: fee > 0 ? `${fmt(w!.interest_avoided)} LESS ${fmt(fee)} FEE` : undefined,
              tone: w?.invest_instead ? 'neg' : 'pos',
            },
            {
              l: 'EMERGENCY FUND',
              v: out.ef.gt(0) ? `+${fmt(out.ef)}` : '—',
              s: out.gapAfter.gt(0) ? `${fmt(out.gapAfter)} STILL TO GO` : 'FULL',
            },
            {
              l: 'PARK IT AT',
              v: out.cy?.alert && out.cy.best_alt_yield
                ? `${(Number(out.cy.best_alt_yield) * 100).toFixed(1)}%`
                : '—',
              s: out.cy?.alert ? (out.cy.alt_name ?? '').toUpperCase() : out.ef.gt(0) ? 'WHERE IT IS IS FINE' : '',
              tone: 'accent',
            },
            {
              l: 'SCORE BUMP',
              v: impact ? `+${impact.delta_low}–${impact.delta_high}` : '—',
              s: impact ? 'CARD UTILISATION DROPS' : '',
              tone: 'pos',
            },
          ]}
          actions={
            profile.isLive ? (
              <LBracket accent onClick={logIt} disabled={applied || busy}>
                {applied ? 'LOGGED ✓' : 'I DID THIS — LOG IT'}
              </LBracket>
            ) : (
              <LBracket href="/onboarding">SET UP YOUR PROFILE TO LOG IT</LBracket>
            )
          }
        />
      )}

      {out && (
        <LToolMath
          rows={[
            { k: 'spare cash', v: fmt(out.total) },
            {
              k: 'emergency fund',
              v: fmt(out.ef),
              note: out.ef.gt(0)
                ? `your plan's split sends ${(Number(readEfSplitClient()) * 100).toFixed(0)}% here until the fund is full`
                : 'the fund is already full',
            },
            ...(out.cy?.alert
              ? [{
                  k: 'park it at',
                  v: `${out.cy.alt_name ?? '—'}`,
                  note: `earns ${fmt(out.cy.annual_uplift ?? 0)} a year more than ${earning}% and stays within reach`,
                  tone: 'pos' as const,
                }]
              : []),
            ...(w && hold
              ? [{ k: 'keep it', v: fmt(w.leftover), note: w.rationale }]
              : []),
            ...(w && !hold
              ? [
                  {
                    k: w.invest_instead ? 'invest in' : 'pay off',
                    v: `${fmt(w.amount)} → ${targetName}`,
                    note: w.rationale,
                  },
                  {
                    k: w.invest_instead ? 'interest given up' : 'interest avoided',
                    v: fmt(w.interest_avoided),
                    tone: (w.invest_instead ? 'neg' : 'pos') as 'neg' | 'pos',
                    // A card has no tenure: its figure runs until the card is
                    // cleared at the usual or minimum payment, and says so.
                    note: w.invest_instead
                      ? `what prepaying would have saved (${w.interest_basis || 'over the loan’s remaining life'}); the investment should beat it`
                      : w.interest_basis || 'over the loan’s remaining life, EMI kept, so it ends sooner',
                  },
                  ...(fee > 0
                    ? [{
                        k: 'prepayment fee',
                        v: fmt(fee),
                        tone: 'neg' as const,
                        note: `your loan's terms; it comes out of the payment, so ${fmt(Number(w.amount) - fee)} goes to principal and ${fmt(w.net_benefit ?? 0)} is saved`,
                      }]
                    : []),
                ]
              : []),
            ...(w?.blocked?.length && !hold
              ? [{ k: 'passed over', v: '—', note: `${w.blocked.join('; ')}.` }]
              : []),
            ...(leftover > 0
              ? [{ k: 'left over', v: fmt(leftover), note: 'the loan clears; keep this or run it again' }]
              : []),
          ]}
        />
      )}
    </>
  );
}

// ─── inline LField-shaped input that doesn't pull in the heavy
//     `Field` component from `ToolPrimitives` (which carries its own
//     non-ledger styling). Plain monospace input + dashed underline
//     matches the prototype. ──────────────────────────────────────────
function LToolField({
  label,
  value,
  onChange,
  hint,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string | null;
}) {
  const id = useId();
  const described = [error ? `${id}-err` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ');
  // The label names only the input; the hint and error describe it.
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontFamily:
          "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace",
      }}
    >
      <label
        htmlFor={id}
        style={{
          fontSize: 9,
          letterSpacing: '0.18em',
          color: L_T.muted,
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        style={{
          background: 'transparent',
          border: 'none',
          borderBottom: `1px solid ${error ? L_T.negative : L_T.ink}`,
          padding: '6px 0',
          fontFamily: 'inherit',
          fontSize: 14,
          fontWeight: 700,
          color: L_T.ink,
        }}
      />
      {error && (
        <span id={`${id}-err`} role="alert" style={{ fontSize: 11, color: L_T.negative }}>
          {error}
        </span>
      )}
      {hint && (
        <span id={`${id}-hint`} style={{ fontSize: 10, color: L_T.muted, lineHeight: 1.5 }}>
          {hint}
        </span>
      )}
    </div>
  );
}
