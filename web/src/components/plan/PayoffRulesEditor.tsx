'use client';

/**
 * "Your rules" editor (roadmap PR E; replaces Hybrid). Shown under the
 * strategy switcher when the strategy is 'rules'. Three rules, applied in
 * engine/ordering.apply_rules order:
 *   1. a custom order (when set, it wins),
 *   2. loans pinned to the front,
 *   3. "clear any loan under X first", smallest first;
 * everything else by highest effective rate. Each save re-runs the plan
 * (cookie + synced slice, then router.refresh), and the line under the
 * editor prices the rules against Avalanche from the plan's own runs.
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Country, UserPayload } from '@/lib/api';
import { LOAN_TYPE_NAME } from '@/lib/loan-types';
import { monthIndexToCountryLabel } from '@/lib/today';
import {
  hybridRules,
  readRulesClient,
  rulesForLoans,
  writeRulesClient,
  type PayoffRules,
} from '@/lib/payoff-rules';

export interface RulesCost {
  /** Interest under the rules minus interest under Avalanche (≥ 0 normally). */
  extraInterest: number;
  /** Debt-free month under the rules minus Avalanche's (positive = later). */
  extraMonths: number | null;
}

type Outcome = { debtFreeMonth: number | null; totalInterest: string };

/** What the rules cost against Avalanche, from the plan's two runs. */
export function rulesCost(rules: Outcome | undefined, avalanche: Outcome | undefined): RulesCost | null {
  if (!rules || !avalanche) return null;
  const extraInterest = Number(rules.totalInterest || 0) - Number(avalanche.totalInterest || 0);
  const extraMonths =
    rules.debtFreeMonth != null && avalanche.debtFreeMonth != null ? rules.debtFreeMonth - avalanche.debtFreeMonth : null;
  return { extraInterest, extraMonths };
}

export function rulesCostWords(cost: RulesCost | null, money: (n: number) => string, avalancheMonth: number | null, country: Country): string {
  if (!cost) return 'Cost against Avalanche: shown once the plan has run.';
  const i = Math.round(cost.extraInterest);
  const when =
    cost.extraMonths == null || cost.extraMonths === 0
      ? 'the same debt-free month'
      : cost.extraMonths > 0
        ? `debt-free ${cost.extraMonths} month${cost.extraMonths === 1 ? '' : 's'} later${avalancheMonth != null ? ` than ${monthIndexToCountryLabel(avalancheMonth, country)}` : ''}`
        : `debt-free ${-cost.extraMonths} month${cost.extraMonths === -1 ? '' : 's'} sooner`;
  if (Math.abs(i) < 1) return `Against Avalanche: no extra interest, ${when}.`;
  if (i > 0) return `Against Avalanche: ${money(i)} more interest, ${when}.`;
  return `Against Avalanche: ${money(-i)} less interest, ${when}.`;
}

function loanName(l: UserPayload['loans'][number]): string {
  const type = LOAN_TYPE_NAME[l.loan_type] ?? l.loan_type;
  const bank = (l.bank ?? '').replace(/\s+bank$/i, '').trim();
  return bank ? `${bank} ${type}` : type.charAt(0).toUpperCase() + type.slice(1);
}

export function PayoffRulesEditor({
  user,
  cost,
  avalancheMonth,
  money,
}: {
  user: UserPayload;
  cost: RulesCost | null;
  avalancheMonth: number | null;
  money: (n: number) => string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const open = user.loans.flatMap((l, i) => (Number(l.outstanding) > 0 ? [i] : []));
  const [rules, setRules] = useState<PayoffRules>(() => hybridRules(user.country));
  useEffect(() => {
    setRules(rulesForLoans(readRulesClient() ?? hybridRules(user.country), user.loans.length));
  }, [user.country, user.loans.length]);

  const save = (next: PayoffRules) => {
    setRules(next);
    writeRulesClient(next);
    startTransition(() => router.refresh());
  };
  const smallOn = rules.small_first_below != null && Number(rules.small_first_below) > 0;
  const order = rules.custom_order.length > 0 ? [...rules.custom_order, ...open.filter((i) => !rules.custom_order.includes(i))] : open;
  const move = (i: number, dir: -1 | 1) => {
    const o = [...order];
    const at = o.indexOf(i);
    const to = at + dir;
    if (to < 0 || to >= o.length) return;
    [o[at], o[to]] = [o[to], o[at]];
    save({ ...rules, custom_order: o });
  };
  const box: React.CSSProperties = { fontSize: 11, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' };
  const btn: React.CSSProperties = { background: 'transparent', border: '1px solid var(--border)', padding: '0 6px', cursor: pending ? 'wait' : 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11 };

  return (
    <div aria-label="Your payoff rules" role="group" style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 6, borderLeft: '2px solid var(--accent)' }}>
      <label style={box}>
        <input
          type="checkbox"
          checked={smallOn}
          disabled={pending || rules.custom_order.length > 0}
          onChange={(e) => save({ ...rules, small_first_below: e.target.checked ? hybridRules(user.country).small_first_below : null })}
        />
        Clear any loan under
        <input
          type="number"
          min={1}
          aria-label="Small-balance limit"
          value={rules.small_first_below ?? ''}
          disabled={pending || !smallOn || rules.custom_order.length > 0}
          onChange={(e) => setRules({ ...rules, small_first_below: e.target.value })}
          onBlur={() => save({ ...rules, small_first_below: Number(rules.small_first_below) > 0 ? String(Number(rules.small_first_below)) : null })}
          style={{ width: 90, fontSize: 11 }}
        />
        first, smallest first
      </label>
      <div style={{ ...box, flexDirection: 'column', alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--muted)' }}>
          {rules.custom_order.length > 0 ? 'Your order (the other rules are off while you set one):' : 'Pin a loan to the front, or set the whole order:'}
        </span>
        <ol style={{ margin: 0, paddingLeft: 18 }}>
          {order.map((i) => {
            const pinned = rules.pinned.includes(i);
            return (
              <li key={i} style={{ ...box, margin: '2px 0' }}>
                <span>{loanName(user.loans[i])}</span>
                <button type="button" style={btn} disabled={pending} aria-label={`Move ${loanName(user.loans[i])} up`} onClick={() => move(i, -1)}>↑</button>
                <button type="button" style={btn} disabled={pending} aria-label={`Move ${loanName(user.loans[i])} down`} onClick={() => move(i, 1)}>↓</button>
                {rules.custom_order.length === 0 && (
                  <button
                    type="button"
                    style={btn}
                    disabled={pending}
                    onClick={() => save({ ...rules, pinned: pinned ? rules.pinned.filter((p) => p !== i) : [...rules.pinned, i] })}
                  >
                    {pinned ? 'UNPIN' : 'PIN FIRST'}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
        {rules.custom_order.length > 0 && (
          <button type="button" style={btn} disabled={pending} onClick={() => save({ ...rules, custom_order: [] })}>
            CLEAR MY ORDER
          </button>
        )}
      </div>
      <div style={{ fontSize: 11, color: cost && cost.extraInterest >= 1 ? 'var(--negative, #b42318)' : 'var(--muted)' }} aria-live="polite">
        {pending ? 'Working it out…' : rulesCostWords(cost, money, avalancheMonth, user.country)}
      </div>
    </div>
  );
}
