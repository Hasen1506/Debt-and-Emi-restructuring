'use client';

/**
 * A goal's OPEN panel (REDESIGN R5.1): when saving starts and how much,
 * the money put in so far, and, when it falls short, what would close
 * the gap, each with one button that does it.
 */

import { useState } from 'react';
import { formatCurrencyWhole } from '@/lib/api';
import { KEPT_IN_LABEL, type Goal, type GoalFundingSource } from '@/lib/goals';
import type { GoalContributionEntry } from '@/lib/goal-contributions';
import type { GoalLine } from '@/lib/goal-line';
import type { AmountCurrency } from '@/lib/amount';
import { Field } from '@/components/ToolPrimitives';
import { LBracket, LMathBlock, L_T } from '@/components/ledger/primitives';
import { monthLabel } from './GoalForm';

const SOURCE_LABEL: Record<GoalFundingSource, string> = {
  surplus: 'from spare cash',
  ef: 'from the emergency fund',
  liquidation: 'from selling investments',
  new_loan: 'a new loan',
};

function addMonths(today: Date, n: number): string {
  const d = new Date(today.getFullYear(), today.getMonth() + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** A word on where the money sits, when it doesn't suit the date. */
function keptInNote(goal: Goal, months: number): string | null {
  if (goal.keptIn === 'equity' && months < 36)
    return 'Shares and equity funds can fall 20–30% in a bad year. For money needed within three years, a fixed deposit or debt fund is safer.';
  if (goal.keptIn === 'savings' && months > 12)
    return 'Money you won’t touch for over a year earns more in a fixed deposit or liquid fund than in a savings account.';
  return null;
}

export function GoalDetail({
  goal,
  line,
  currency,
  today,
  planProjects,
  contributions,
  indicativeRate,
  indicativeBank,
  onPatch,
  onAddMoney,
  onRemoveMoney,
  onCutSpending,
  totalExpenses,
}: {
  goal: Goal;
  line: GoalLine;
  currency: AmountCurrency;
  today: Date;
  planProjects: boolean;
  contributions: GoalContributionEntry[];
  indicativeRate: number;
  indicativeBank: string | null;
  onPatch: (p: Partial<Goal>) => void;
  onAddMoney: (amount: string) => void;
  onRemoveMoney: (id: string) => void;
  /** Lowers monthly spending by this much; false when it didn't save. */
  onCutSpending: (monthly: number) => boolean;
  /** Monthly spending: a cut of more than 70% of it isn't offered. */
  totalExpenses: number;
}) {
  const fmt = (n: number | string) => formatCurrencyWhole(n, currency);
  const [amount, setAmount] = useState('');
  const [amountErr, setAmountErr] = useState<string | null>(null);
  const [confirmCut, setConfirmCut] = useState(false);
  const [cutDone, setCutDone] = useState(false);
  const open = line.state !== 'closed';
  const short = line.state === 'short' || line.state === 'needs_backup';
  const lv = line.levers;
  const note = keptInNote(goal, line.months);

  function add() {
    if (!(Number(amount) > 0)) {
      setAmountErr('Enter the amount you put in.');
      return;
    }
    onAddMoney(amount);
    setAmount('');
    setAmountErr(null);
  }

  // The backup sources the recommended path leans on, in plain words.
  const backup = line.rec && line.state === 'needs_backup' ? line.rec.sources.filter((s) => s.contributes > 0) : [];
  const fixes: { what: string; action?: { label: string; run: () => void } }[] = [];
  if (short && lv) {
    if (goal.deadlineKind !== 'hard' && lv.extendMonthsBy && lv.extendMonthsBy > 0) {
      const to = addMonths(new Date(Number(goal.targetMonth.slice(0, 4)), Number(goal.targetMonth.slice(5, 7)) - 1, 1), lv.extendMonthsBy);
      fixes.push({
        what: `Move the date to ${monthLabel(to)} (${lv.extendMonthsBy} months later).`,
        action: { label: 'MOVE IT', run: () => onPatch({ targetMonth: to }) },
      });
    }
    if (lv.lowerTargetBy > 0) {
      const base = Number(goal.amount);
      const buf = 1 + Number(goal.bufferPct || 0);
      const to = Math.max(0, Math.floor((line.required - lv.lowerTargetBy) / buf / 1000) * 1000);
      if (to > 0 && to < base)
        fixes.push({
          what: `Aim for ${fmt(to)} instead of ${fmt(base)}.`,
          action: { label: 'LOWER IT', run: () => onPatch({ amount: String(to) }) },
        });
    }
    if (!goal.priorityBump && lv.bumpPriorityGain > 0) {
      fixes.push({
        what: `Save for it before your other goals: ${fmt(lv.bumpPriorityGain)} more reaches it${lv.bumpPriorityClosesGap ? ', enough to close the gap' : ''}.`,
        action: { label: 'MAKE IT FIRST', run: () => onPatch({ priorityBump: true }) },
      });
    }
    if (lv.increaseSurplusBy > 0 && !cutDone) {
      const steep = !(totalExpenses > 0 && lv.increaseSurplusBy <= 0.7 * totalExpenses);
      fixes.push({
        what: steep
          ? `Have ${fmt(lv.increaseSurplusBy)} more spare a month (more than cutting spending could free).`
          : `Spend ${fmt(lv.increaseSurplusBy)} less a month from now.`,
        action: steep
          ? undefined
          : confirmCut
            ? { label: `CONFIRM: CUT ${fmt(lv.increaseSurplusBy)}/MO`, run: () => setCutDone(onCutSpending(lv.increaseSurplusBy)) }
            : { label: 'CUT SPENDING', run: () => setConfirmCut(true) },
      });
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12, lineHeight: 1.6 }}>
      {open && line.state !== 'funded' && line.state !== 'no_amount' && (
        <div>
          {line.state === 'past' ? (
            <span style={{ color: L_T.negative }}>
              {monthLabel(goal.targetMonth)} has passed with {fmt(line.remaining)} still to go. Move the date, or archive it.
            </span>
          ) : (
            <>
              <strong>
                {line.state === 'short' ? 'It needs' : 'Put aside'} {fmt(line.monthly)} a month
                {line.startIndex > 0 ? ` from ${monthLabel(addMonths(today, line.startIndex))}` : ' from now'} until {monthLabel(goal.targetMonth)}.
              </strong>
              {line.state !== 'on_track' && line.tiers[0] && (
                <>
                  {' '}
                  <span style={{ color: L_T.muted }}>
                    Your spare cash{goal.priorityBump ? '' : ', after the goals ahead of it,'} reaches {fmt(line.tiers[0].reachable)} of {fmt(line.required)} by then.
                  </span>
                </>
              )}
              {planProjects && line.startIndex > 0 && (
                <>
                  {' '}
                  <span style={{ color: L_T.muted }}>Until then your spare cash clears debts first, which costs less interest.</span>{' '}
                  <LBracket onClick={() => onPatch({ autoDefer: false, fundingStartMonth: undefined })}>START NOW</LBracket>
                </>
              )}
              {planProjects && goal.autoDefer === false && (
                <>
                  {' '}
                  <span style={{ color: L_T.muted }}>Saving now, alongside the debts.</span>{' '}
                  <LBracket onClick={() => onPatch({ autoDefer: true, fundingStartMonth: undefined })}>CLEAR DEBTS FIRST</LBracket>
                </>
              )}
            </>
          )}
        </div>
      )}

      {short && (
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.14em', color: L_T.muted, fontWeight: 700, marginBottom: 4 }}>
            {line.state === 'needs_backup' ? 'SPARE CASH ALONE FALLS SHORT' : `SHORT BY ${fmt(line.rec?.shortfall ?? line.remaining)}`}
          </div>
          {backup.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              It gets there with{' '}
              {backup
                .map((s) =>
                  s.source === 'new_loan'
                    ? `${fmt(s.contributes)} as a new loan at about ${(indicativeRate * 100).toFixed(1)}%${indicativeBank ? ` (${indicativeBank})` : ''}`
                    : `${fmt(s.contributes)} ${SOURCE_LABEL[s.source]}`,
                )
                .join(', ')}
              .
              {backup.some((s) => s.source === 'liquidation') && (
                <>
                  {' '}
                  <LBracket href={`/tools/liquidate?required=${Math.round(line.rec?.shortfall ?? 0)}&context=${encodeURIComponent(`Goal: ${goal.label}`)}`}>
                    WHAT TO SELL →
                  </LBracket>
                </>
              )}
            </div>
          )}
          {fixes.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ color: L_T.muted }}>{backup.length > 0 ? 'Or, to do it from spare cash:' : 'Any one of these closes it:'}</span>
              {fixes.map((f, i) => (
                <div key={i} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline', borderTop: i ? `1px dashed ${L_T.ruleSoft}` : undefined, padding: '4px 0' }}>
                  <span style={{ flex: '1 1 260px' }}>{f.what}</span>
                  {f.action && (
                    <LBracket accent onClick={f.action.run}>
                      {f.action.label}
                    </LBracket>
                  )}
                </div>
              ))}
            </div>
          )}
          {cutDone && (
            <div style={{ color: L_T.positive }}>Spending lowered from now. Activity has it, with UNDO.</div>
          )}
          {fixes.length === 0 && backup.length === 0 && (
            <div style={{ color: L_T.negative }}>
              Not reachable from spare cash, even with more time. Let it use your emergency fund or investments (EDIT → more), or lower the amount.
            </div>
          )}
        </div>
      )}

      {note && <div style={{ color: L_T.muted, borderLeft: `3px solid ${L_T.accent}`, paddingLeft: 8 }}>{note}</div>}

      <div>
        <div style={{ fontSize: 10, letterSpacing: '0.14em', color: L_T.muted, fontWeight: 700, marginBottom: 4 }}>
          PUT IN SO FAR · {fmt(line.saved)}
          {goal.keptIn ? ` · ${KEPT_IN_LABEL[goal.keptIn].toUpperCase()}` : ''}
        </div>
        {contributions.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            {contributions.map((c) => (
              <div key={c.id} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline', padding: '2px 0' }}>
                <span style={{ color: L_T.muted, minWidth: 86 }}>{c.date}</span>
                <span style={{ fontWeight: 700, minWidth: 90 }}>{fmt(c.amount)}</span>
                {c.source && <span style={{ color: L_T.muted }}>{c.source}</span>}
                <LBracket onClick={() => onRemoveMoney(c.id)} label={`Remove ${fmt(c.amount)} on ${c.date}`}>
                  REMOVE
                </LBracket>
              </div>
            ))}
          </div>
        )}
        {open && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: '0 1 220px' }}>
              <Field label="Add money put in today" kind="money" currency={currency} value={amount} onChange={setAmount} error={amountErr} />
            </div>
            <LBracket accent onClick={add} style={{ paddingBottom: 10 }}>
              ADD
            </LBracket>
          </div>
        )}
      </div>

      {line.required > 0 && (
        <LMathBlock
          rows={[
            { k: 'target', v: fmt(goal.amount) },
            ...(Number(goal.bufferPct) > 0
              ? [{ k: `+ ${Math.round(Number(goal.bufferPct) * 100)}% buffer`, v: fmt(line.required), note: 'for surprises' }]
              : []),
            { k: '− put in so far', v: fmt(line.saved) },
            { k: 'still to go', v: fmt(line.remaining), tone: line.remaining > 0 ? undefined : ('pos' as const) },
            ...(line.remaining > 0 && line.months > 0
              ? [
                  {
                    k: line.startIndex > 0 ? `÷ ${line.months - line.startIndex} months of saving` : `÷ ${line.months} months`,
                    v: `${fmt(line.monthly)} a month`,
                    note: line.startIndex > 0 ? `starts ${monthLabel(addMonths(today, line.startIndex))}` : undefined,
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
}
