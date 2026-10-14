'use client';

/**
 * New goal / edit goal (REDESIGN R5.2). Four questions: what it's for,
 * how much, by when, and whether it goes first. Optional: already saved,
 * where it's kept, a date that can't move, the buffer, and what it may
 * fall back on. The monthly amount shows before saving.
 */

import { useEffect, useMemo, useState } from 'react';
import { goalBuffer } from '@/lib/assumptions';
import { loadProfileClient } from '@/lib/user-store';
import { fundingRuleError, fundingRuleLabel, highInterestLoans, ruleOf } from '@/lib/goal-funding';
import { formatCurrencyWhole } from '@/lib/api';
import {
  GOAL_PRESETS,
  KEPT_IN_LABEL,
  blankGoal,
  goalAmountBlurError,
  goalAmountError,
  type Goal,
  type GoalFundingSource,
  type GoalKeptIn,
  type GoalKind,
} from '@/lib/goals';
import { GOAL_STATE_LABEL, goalStateTone, type GoalLine } from '@/lib/goal-line';
import { MONTH_NAMES_SHORT } from '@/lib/today';
import type { AmountCurrency } from '@/lib/amount';
import { Field } from '@/components/ToolPrimitives';
import { MonthYearPicker } from '@/components/MonthYearPicker';
import { LBracket, LChip, LChipRow, L_MONO, L_T } from '@/components/ledger/primitives';

export const GOAL_KINDS: { kind: GoalKind; label: string }[] = [
  { kind: 'downpayment', label: 'A home' },
  { kind: 'wedding', label: 'Wedding' },
  { kind: 'education', label: 'Education' },
  { kind: 'travel', label: 'A trip' },
  { kind: 'medical', label: 'Medical' },
  { kind: 'business_seed', label: 'Business' },
  { kind: 'birthday', label: 'Celebration' },
  { kind: 'custom', label: 'Something else' },
];

const BACKUPS: { src: GoalFundingSource; label: string }[] = [
  { src: 'ef', label: 'Emergency fund' },
  { src: 'liquidation', label: 'Sell investments' },
  { src: 'new_loan', label: 'A new loan' },
];

export interface GoalDraft {
  goal: Goal;
  alreadySaved: number;
}

function addMonths(today: Date, n: number): string {
  const d = new Date(today.getFullYear(), today.getMonth() + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function GoalForm({
  initial,
  today,
  currency,
  preview,
  onSave,
  onCancel,
}: {
  /** The goal to edit; a new goal when absent. */
  initial?: Goal;
  today: Date;
  currency: AmountCurrency;
  /** The goal's numbers as they'd be saved (for the live line). */
  preview: (goal: Goal, alreadySaved: number) => GoalLine;
  onSave: (draft: GoalDraft) => void;
  onCancel: () => void;
}) {
  const editing = !!initial;
  const [goal, setGoal] = useState<Goal>(() => initial ?? { ...blankGoal('downpayment'), targetMonth: '' });
  const [labelTouched, setLabelTouched] = useState(editing);
  // How a new goal is funded is the person's call (sprint G10, grill #22):
  // no rule is picked for them, and the share of spare cash starts blank.
  const [fundingPicked, setFundingPicked] = useState(editing);
  // A new goal starts with the user's default buffer when they set one.
  useEffect(() => {
    if (!editing) setGoal((g) => ({ ...g, bufferPct: goalBuffer(loadProfileClient().user, g.bufferPct) }));
  }, [editing]);
  const [saved, setSaved] = useState('');
  const [more, setMore] = useState(false);
  const [tried, setTried] = useState(false);
  // O-4: the amount is checked once the person leaves the box, not only at ADD.
  const [amountLeft, setAmountLeft] = useState(false);
  const fmt = (n: number) => formatCurrencyWhole(n, currency);
  const patch = (p: Partial<Goal>) => setGoal((g) => ({ ...g, ...p }));

  function pickKind(kind: GoalKind) {
    const p = GOAL_PRESETS[kind];
    setGoal((g) => ({
      ...g,
      kind,
      label: labelTouched ? g.label : p.label,
      // Keep the person's own choices when editing; a new goal takes the kind's defaults.
      ...(editing
        ? {}
        : {
            // The user's default buffer (Profile → Assumptions) when set.
            bufferPct: goalBuffer(loadProfileClient().user, p.bufferPct),
            priorityBump: p.priorityBump,
            fundingSources: [...p.fundingSources],
            deadlineKind: p.deadlineKind,
          }),
    }));
  }

  const thisMonth = addMonths(today, 0);
  const errors = {
    label: goal.label.trim() ? null : 'Name it, e.g. "Home down payment".',
    amount: goalAmountError(goal.amount),
    targetMonth: !/^\d{4}-\d{2}$/.test(goal.targetMonth)
      ? 'Pick when you need it.'
      : goal.targetMonth <= thisMonth
        ? 'Pick a month after this one.'
        : null,
    saved: saved && !(Number(saved) >= 0) ? 'Enter an amount, or leave it blank.' : null,
    funding: fundingPicked ? fundingRuleError(goal.fundingRule) : 'Pick how the plan pays into it: debt first, on schedule, a fixed amount or a share of spare cash.',
  };
  const valid = !errors.label && !errors.amount && !errors.targetMonth && !errors.saved && !errors.funding;
  const show = (k: keyof typeof errors) => (tried ? errors[k] : null);
  const line = useMemo(
    () => (valid ? preview(goal, Number(saved || 0)) : null),
    [valid, preview, goal, saved],
  );

  const years = Array.from({ length: 31 }, (_, i) => today.getFullYear() + i);
  const [ty, tm] = goal.targetMonth ? goal.targetMonth.split('-') : ['', ''];
  const setYM = (y: string, m: string) => patch({ targetMonth: y && m ? `${y}-${m}` : y ? `${y}-${tm || '01'}` : '' });
  const quick = [12, 24, 36, 60];

  function submit() {
    setTried(true);
    if (!valid) return;
    onSave({ goal: { ...goal, label: goal.label.trim() }, alreadySaved: Number(saved || 0) });
  }

  const tone = line ? goalStateTone(line.state) : null;
  const toneColor = tone === 'pos' ? L_T.positive : tone === 'neg' ? L_T.negative : tone === 'accent' ? L_T.accent : L_T.ink;
  const select: React.CSSProperties = {
    fontFamily: L_MONO,
    fontSize: 13,
    padding: '7px 8px',
    border: `1px solid ${show('targetMonth') ? L_T.negative : L_T.ruleSoft}`,
    background: L_T.paper,
    color: L_T.ink,
  };

  return (
    <div
      role="group"
      aria-label={editing ? `Edit ${initial?.label || 'goal'}` : 'New goal'}
      style={{ border: `1px solid ${L_T.ink}`, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14, background: L_T.bg }}
    >
      <div style={{ fontSize: 11, letterSpacing: '0.16em', fontWeight: 700 }}>{editing ? 'EDIT GOAL' : 'NEW GOAL'}</div>

      <LChipRow label="1 · What it's for">
        {GOAL_KINDS.map(({ kind, label }) => (
          <LChip key={kind} on={goal.kind === kind} onClick={() => pickKind(kind)}>
            {label}
          </LChip>
        ))}
      </LChipRow>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 12 }}>
        <Field
          label="Name"
          kind="text"
          value={goal.label}
          onChange={(v) => {
            setLabelTouched(true);
            patch({ label: v });
          }}
          error={show('label')}
        />
        <Field
          label="2 · How much it needs"
          kind="money"
          currency={currency}
          value={goal.amount}
          onChange={(v) => patch({ amount: v })}
          onBlur={() => setAmountLeft(true)}
          error={show('amount') ?? goalAmountBlurError(goal.amount, amountLeft)}
          hint={
            Number(goal.amount) > 0 && Number(goal.bufferPct) > 0
              ? `+${Math.round(Number(goal.bufferPct) * 100)}% buffer: ${fmt(Number(goal.amount) * (1 + Number(goal.bufferPct)))}`
              : undefined
          }
        />
      </div>

      <div role="group" aria-label="3 · By when" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12, color: L_T.muted }}>3 · By when</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {quick.map((n) => {
            const v = addMonths(today, n);
            return (
              <LChip key={n} on={goal.targetMonth === v} onClick={() => patch({ targetMonth: v })}>
                {n / 12} {n === 12 ? 'year' : 'years'}
              </LChip>
            );
          })}
          <span style={{ fontSize: 12, color: L_T.muted, margin: '0 4px' }}>or</span>
          <select aria-label="Month" value={tm} onChange={(e) => setYM(ty || String(today.getFullYear() + 1), e.target.value)} style={select}>
            <option value="">Month</option>
            {MONTH_NAMES_SHORT.map((m, i) => (
              <option key={m} value={String(i + 1).padStart(2, '0')}>
                {m}
              </option>
            ))}
          </select>
          <select aria-label="Year" value={ty} onChange={(e) => setYM(e.target.value, tm)} style={select}>
            <option value="">Year</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        {show('targetMonth') && (
          <span role="alert" style={{ fontSize: 11, color: L_T.negative }}>
            {show('targetMonth')}
          </span>
        )}
      </div>

      <LChipRow label="4 · Against your other goals">
        <LChip on={goal.priorityBump} onClick={() => patch({ priorityBump: true })}>
          ★ Before the others
        </LChip>
        <LChip on={!goal.priorityBump} onClick={() => patch({ priorityBump: false })}>
          Soonest date first
        </LChip>
      </LChipRow>

      <FundingRulePicker
        goal={goal}
        picked={fundingPicked}
        patch={(p) => {
          setFundingPicked(true);
          patch(p);
        }}
        currency={currency}
        error={show('funding')}
      />

      <div>
        <LBracket onClick={() => setMore((m) => !m)}>{more ? '− LESS' : '+ MORE — OPTIONAL'}</LBracket>
        {!more && (
          <span style={{ fontSize: 11, color: L_T.muted, marginLeft: 8 }}>
            {[
              !editing && 'already saved',
              goal.keptIn ? KEPT_IN_LABEL[goal.keptIn].toLowerCase() : 'where it’s kept',
              goal.deadlineKind === 'hard' ? 'date can’t move' : 'date can move',
              `${Math.round(Number(goal.bufferPct || 0) * 100)}% buffer`,
            ]
              .filter(Boolean)
              .join(' · ')
              .replace(/^./, (c) => c.toUpperCase())}
          </span>
        )}
      </div>
      {more && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 10, borderLeft: `2px solid ${L_T.ruleSoft}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 12 }}>
            {!editing && (
              <Field
                label="Already saved for it"
                kind="money"
                currency={currency}
                value={saved}
                onChange={setSaved}
                error={show('saved')}
              />
            )}
            <Field
              label="Buffer"
              kind="percent"
              value={goal.bufferPct}
              onChange={(v) => patch({ bufferPct: v })}
              hint="Extra on top, for surprises"
            />
          </div>
          <LChipRow label="Where it's kept">
            {(Object.keys(KEPT_IN_LABEL) as GoalKeptIn[]).map((k) => (
              <LChip key={k} on={goal.keptIn === k} onClick={() => patch({ keptIn: goal.keptIn === k ? undefined : k })}>
                {KEPT_IN_LABEL[k]}
              </LChip>
            ))}
          </LChipRow>
          <LChipRow label="Can the date move?">
            <LChip on={goal.deadlineKind !== 'hard'} onClick={() => patch({ deadlineKind: 'soft' })}>
              Yes, if needed
            </LChip>
            <LChip on={goal.deadlineKind === 'hard'} onClick={() => patch({ deadlineKind: 'hard' })}>
              No, it&apos;s fixed
            </LChip>
          </LChipRow>
          <LChipRow label="If spare cash falls short, it may use">
            {BACKUPS.map(({ src, label }) => {
              const on = goal.fundingSources.includes(src);
              return (
                <LChip
                  key={src}
                  on={on}
                  onClick={() =>
                    patch({
                      fundingSources: on ? goal.fundingSources.filter((s) => s !== src) : [...goal.fundingSources, src],
                    })
                  }
                >
                  {label}
                </LChip>
              );
            })}
          </LChipRow>
        </div>
      )}

      {line && (
        <div aria-live="polite" style={{ fontSize: 12, borderTop: `1px dashed ${L_T.ruleSoft}`, paddingTop: 10, lineHeight: 1.6 }}>
          <strong>
            {line.state === 'funded'
              ? 'Already covered by what’s saved.'
              : `Put aside ${fmt(line.monthly)} a month${line.startIndex > 0 ? ` from ${monthLabel(addMonths(today, line.startIndex))}` : ''} until ${monthLabel(goal.targetMonth)}.`}
          </strong>{' '}
          <span style={{ color: toneColor, fontWeight: 700, letterSpacing: '0.08em', fontSize: 11 }}>{GOAL_STATE_LABEL[line.state]}</span>
          {line.startIndex > 0 && (
            <div style={{ color: L_T.muted, fontSize: 11 }}>Until then your spare cash clears debts first, which costs less interest.</div>
          )}
          {line.state === 'short' && (
            <div style={{ color: L_T.muted, fontSize: 11 }}>
              Your spare cash covers {fmt(line.rec?.reachable ?? 0)} of {fmt(line.required)} by then. Save it, then open the goal for ways to close the gap.
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={submit}
          style={{
            fontFamily: L_MONO,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.12em',
            padding: '9px 14px',
            background: L_T.ink,
            color: L_T.bg,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          [ {editing ? 'SAVE' : 'ADD GOAL'} ]
        </button>
        <LBracket onClick={onCancel}>CANCEL</LBracket>
      </div>
    </div>
  );
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  const i = Number(m) - 1;
  if (!(i >= 0 && i < 12)) return ym;
  return `${MONTH_NAMES_SHORT[i]} ${y}`;
}


/** 5 · How the plan pays into it (roadmap PR F). Debt first by default. */
function FundingRulePicker({ goal, picked, patch, currency, error }: { goal: Goal; picked: boolean; patch: (p: Partial<Goal>) => void; currency: AmountCurrency; error: string | null }) {
  const user = useMemo(() => loadProfileClient().user, []);
  const loans = user.loans ?? [];
  const rule = ruleOf(goal.fundingRule);
  // Audit 80+: the limits (cap, floor, until) stay when the rule changes.
  const limits = { until: rule.until, cap: rule.cap, pauseBelow: rule.pauseBelow };
  const set = (r: NonNullable<Goal['fundingRule']>) => patch({ fundingRule: { ...limits, ...r } });
  const high = highInterestLoans(loans, user.country);
  const open = loans.map((l, i) => ({ l, i })).filter(({ l }) => Number(l.outstanding) > 0);
  return (
    <div>
      <LChipRow label="5 · How to fund it">
        <LChip on={picked && rule.kind === 'after_debt' && (rule.afterLoanIndex ?? null) === null} onClick={() => set({ kind: 'after_debt', afterLoanIndex: null })}>
          Debt first
        </LChip>
        <LChip on={picked && rule.kind === 'schedule'} onClick={() => set({ kind: 'schedule' })}>
          On schedule from now
        </LChip>
        <LChip on={picked && rule.kind === 'fixed'} onClick={() => set({ kind: 'fixed', amount: rule.amount ?? '' })}>
          A fixed amount a month
        </LChip>
        <LChip on={picked && rule.kind === 'surplus_pct'} onClick={() => set({ kind: 'surplus_pct', pct: rule.pct ?? '' })}>
          A share of spare cash
        </LChip>
        {open.length > 0 && (
          <LChip on={picked && rule.kind === 'after_debt' && typeof rule.afterLoanIndex === 'number'} onClick={() => set({ kind: 'after_debt', afterLoanIndex: open[0].i })}>
            After a loan is paid off
          </LChip>
        )}
      </LChipRow>
      {picked && rule.kind === 'fixed' && (
        <Field label="Amount a month" kind="money" currency={currency} value={rule.amount ?? ''} onChange={(v: string) => set({ kind: 'fixed', amount: v })} />
      )}
      {picked && rule.kind === 'surplus_pct' && (
        <Field
          label="Share of spare cash (%)"
          value={rule.pct ? String(Math.round(Number(rule.pct) * 100)) : ''}
          onChange={(v: string) => set({ kind: 'surplus_pct', pct: v === '' ? '' : String(Number(v) / 100) })}
        />
      )}
      {picked && rule.kind === 'after_debt' && typeof rule.afterLoanIndex === 'number' && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
          Which loan
          <select aria-label="Which loan" value={rule.afterLoanIndex} onChange={(e) => set({ ...rule, kind: 'after_debt', afterLoanIndex: Number(e.target.value) })}>
            {open.map(({ l, i }) => (
              <option key={i} value={i}>{l.bank ? `${l.bank} ` : ''}{l.loan_type.replace('_', ' ')} · {(Number(l.nominal_rate) * 100).toFixed(1)}%</option>
            ))}
          </select>
        </label>
      )}
      {picked && rule.kind === 'after_debt' && (
        <AfterDebtThen rule={rule} set={set} currency={currency} />
      )}
      {picked && <FundingLimits rule={rule} patch={(p) => patch({ fundingRule: { ...rule, ...p } })} currency={currency} />}
      <p data-testid="goal-rule-label" style={{ fontSize: 11, color: L_T.muted, margin: '6px 0 0' }}>
        {picked ? `${fundingRuleLabel(rule, loans, user.country, currency)}.` : 'Your call: the plan doesn’t pick one for you.'}
        {rule.kind !== 'after_debt' && high.length > 0 && ' Saving before your high-interest debt is paid off costs interest; the goal shows how much once saved.'}
      </p>
      {error && <span role="alert" style={{ fontSize: 11, color: L_T.negative }}>{error}</span>}
    </div>
  );
}

type Rule = NonNullable<Goal['fundingRule']>;

/** Audit 80+ programmable diversion: once the debt is paid off, the pace to the
 *  date (default), a fixed amount, or a share of spare cash. */
export function AfterDebtThen({ rule, set, currency }: { rule: Rule; set: (r: Rule) => void; currency: AmountCurrency }) {
  const then = rule.pct != null ? 'pct' : rule.amount != null ? 'fixed' : 'schedule';
  const base: Rule = { kind: 'after_debt', afterLoanIndex: rule.afterLoanIndex ?? null };
  return (
    <div data-testid="goal-after-debt-then" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
      <LChipRow label="Once it’s paid off">
        <LChip on={then === 'schedule'} onClick={() => set(base)}>The pace to the date</LChip>
        <LChip on={then === 'fixed'} onClick={() => set({ ...base, amount: rule.amount ?? '' })}>A fixed amount</LChip>
        <LChip on={then === 'pct'} onClick={() => set({ ...base, pct: rule.pct ?? '' })}>A share of spare cash</LChip>
      </LChipRow>
      {then === 'fixed' && (
        <Field label="Then, a month" kind="money" currency={currency} value={rule.amount ?? ''} onChange={(v: string) => set({ ...base, amount: v })} />
      )}
      {then === 'pct' && (
        <Field
          label="Then, share of spare cash (%)"
          value={rule.pct ? String(Math.round(Number(rule.pct) * 100)) : ''}
          onChange={(v: string) => set({ ...base, pct: v === '' ? '' : String(Number(v) / 100) })}
        />
      )}
    </div>
  );
}

/** Audit 80+ programmable diversion (engine/goals.py): optional limits on any rule. */
export function FundingLimits({ rule, patch, currency }: { rule: Rule; patch: (p: Partial<Rule>) => void; currency: AmountCurrency }) {
  const set = Boolean(rule.cap || rule.pauseBelow || rule.until);
  const thisYear = new Date().getFullYear();
  return (
    <details data-testid="goal-limits" open={set} style={{ marginTop: 8 }}>
      <summary style={{ fontSize: 12, cursor: 'pointer', minHeight: 24 }}>Limits (optional): a monthly most, a pause in lean months, a stop month</summary>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: 10, marginTop: 8 }}>
        <Field
          label="At most a month"
          kind="money"
          currency={currency}
          value={rule.cap ?? ''}
          onChange={(v: string) => patch({ cap: v })}
          hint="Whatever the rule asks, it never takes more than this."
        />
        <Field
          label="Pause when spare cash is under"
          kind="money"
          currency={currency}
          value={rule.pauseBelow ?? ''}
          onChange={(v: string) => patch({ pauseBelow: v })}
          hint="That month’s spare cash goes to your debts instead."
        />
        <MonthYearPicker
          label="Stop saving in"
          value={rule.until ?? ''}
          onChange={(v: string) => patch({ until: v })}
          minYear={thisYear}
          maxYear={thisYear + 40}
          optional
          hint="From this month on it takes nothing, full or not."
        />
      </div>
    </details>
  );
}
