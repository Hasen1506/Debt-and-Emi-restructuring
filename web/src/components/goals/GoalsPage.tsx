'use client';

/**
 * Goals (REDESIGN R5.1–R5.2): the goal ledger. One row per goal (target,
 * saved, by when, a month, status) with OPEN · EDIT · CANCEL (ARCHIVE once
 * funded); the ★ goal carries the accent strip. New and edited goals use
 * the four-question form. Cancelled and archived goals keep what was put
 * in and leave the plan; they fold away under CLOSED.
 */

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { formatCurrencyWhole, type UserPayload } from '@/lib/api';
import {
  isOpenGoal,
  readGoalsClient,
  writeGoalsClient,
  goalSliceWrite,
  type Goal,
} from '@/lib/goals';
import {
  addContribution,
  readContributionsClient,
  removeContribution,
  totalsByGoal,
  writeContributionsClient,
  contributionSliceWrite,
  type GoalContributionEntry,
} from '@/lib/goal-contributions';
import { GOAL_STATE_LABEL, goalContext, goalLine, goalStateTone, type GoalLine } from '@/lib/goal-line';
import { simMonthToCalendar } from '@/lib/goal-defer';
import { readDecisionsClient, prepareDecision, type DecisionEntry } from '@/lib/decisions';
import { commitExpenseReduction } from '@/lib/expense-commit';
import { loadProfileClient } from '@/lib/user-store';
import { persistClientSlices, type ClientSliceWrite } from '@/lib/persist-client-slices';
import { TEMPLATE_CATALOGUE, expandTemplate, type TemplateKind } from '@/lib/life-templates';
import { localIsoDate } from '@/lib/today';
import { useWidth } from '@/lib/use-width';
import type { AmountCurrency } from '@/lib/amount';
import { LBracket, LKpi, LSectionHeader, L_T, lStrip } from '@/components/ledger/primitives';
import { GoalForm, monthLabel, type GoalDraft } from './GoalForm';
import { GoalDetail } from './GoalDetail';

const TONE = { pos: L_T.positive, neg: L_T.negative, accent: L_T.accent } as const;

const gridWide: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '28px minmax(0, 2fr) 104px 150px 76px 112px 104px 196px',
  columnGap: 10,
  alignItems: 'baseline',
};
const gridNarrow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  columnGap: 10,
  alignItems: 'baseline',
};

type FormState = { mode: 'new' } | { mode: 'edit'; id: string } | null;

export function GoalsPage({
  user: userProp,
  lowestRates,
}: {
  user: UserPayload;
  lowestRates: Record<string, { bank: string | null; low: string | null }>;
}) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [contributions, setContributions] = useState<GoalContributionEntry[]>([]);
  const [user, setUser] = useState(userProp);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<FormState>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [showClosed, setShowClosed] = useState(false);
  const [templateNote, setTemplateNote] = useState<{ summary: string; caveats: string[] } | null>(null);
  const [width, ref] = useWidth(900);
  const wide = width >= 760;
  // One "today" for the page, so the months left don't tick over mid-visit.
  const today = useRef(new Date()).current;
  const currency: AmountCurrency = user.country === 'US' ? 'USD' : 'INR';
  const fmt = (n: number | string) => formatCurrencyWhole(n, currency);
  const indicativeRate = Number(lowestRates.personal?.low) || (user.country === 'IN' ? 0.12 : 0.1);
  const indicativeBank = lowestRates.personal?.bank ?? null;

  useEffect(() => {
    const g = readGoalsClient();
    setGoals(g);
    setContributions(readContributionsClient());
    setLoaded(true);
    // No goals yet: the form is the page.
    if (g.length === 0) setForm({ mode: 'new' });
  }, []);

  const saved = useMemo(() => totalsByGoal(contributions), [contributions]);
  const ctx = useMemo(
    () => goalContext({ goals, saved, user, today, indicativeRate }),
    [goals, saved, user, today, indicativeRate],
  );
  const lines = useMemo(() => {
    const out: Record<string, GoalLine> = {};
    for (const g of goals) out[g.id] = goalLine(g, saved[g.id] ?? 0, ctx);
    return out;
  }, [goals, saved, ctx]);

  function updateGoals(next: Goal[]) {
    try {
      if (JSON.stringify(readGoalsClient()) !== JSON.stringify(goals)) throw new Error('Your goals changed elsewhere. Reload before saving.');
      writeGoalsClient(next); setGoals(readGoalsClient()); setError(''); return true;
    }
    catch (e) { setError((e as Error).message); return false; }
  }

  // Keep each goal's saving start where the plan can read it: the last
  // month that still makes the date while there are debts to clear,
  // now when there aren't (or when the person chose to start now).
  useEffect(() => {
    if (!loaded) return;
    let dirty = false;
    const next = goals.map((g) => {
      if (!isOpenGoal(g) || g.autoDefer === false) return g;
      const d = ctx.defer[g.id];
      const wanted =
        ctx.planProjects && d && !d.unreachable && d.startMonthIndex > 0 ? simMonthToCalendar(d.startMonthIndex, today) : undefined;
      if (g.fundingStartMonth === wanted) return g;
      dirty = true;
      return { ...g, fundingStartMonth: wanted };
    });
    if (dirty) updateGoals(next);
  }, [ctx, goals, loaded, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const preview = useMemo(
    () => (draft: Goal, alreadySaved: number) => {
      const s = { ...saved, [draft.id]: (saved[draft.id] ?? 0) + alreadySaved };
      const all = [...goals.filter((g) => g.id !== draft.id), draft];
      return goalLine(draft, s[draft.id], goalContext({ goals: all, saved: s, user, today, indicativeRate }));
    },
    [goals, saved, user, today, indicativeRate],
  );

  function saveGoalChoice(next: Goal[], draft: Omit<DecisionEntry,'id'|'at'|'reverted'>, initialContributions?: GoalContributionEntry[]): boolean {
    try {
      if (JSON.stringify(readGoalsClient()) !== JSON.stringify(goals) || (initialContributions && JSON.stringify(readContributionsClient()) !== JSON.stringify(contributions)))
        throw new Error('Your goals changed elsewhere. Reload before saving.');
      const goalWrite = goalSliceWrite(next);
      const normalized = goalWrite.value as Goal[];
      const resultGoal = normalized.find(g => g.id === draft.result.goalId);
      const history = prepareDecision(readDecisionsClient(), {...draft,result:{...draft.result,...(resultGoal ? {goal:resultGoal} : {})}});
      const writes: ClientSliceWrite[] = [goalWrite];
      if (initialContributions) writes.push(contributionSliceWrite(initialContributions));
      writes.push({key:'rightdue_decisions',value:history,slice:'decisions'});
      persistClientSlices(writes);
      setGoals(readGoalsClient());
      if (initialContributions) setContributions(initialContributions);
      setError('');
      return true;
    } catch (e) { setError((e as Error).message); return false; }
  }

  function saveDraft({ goal, alreadySaved }: GoalDraft) {
    const before = goals.find(g => g.id === goal.id);
    if (before) {
      if (!saveGoalChoice(goals.map(g => g.id === goal.id ? goal : g), {
        kind:'goal_edited',label:`Changed goal: ${goal.label}`,snapshot:{goal:before},result:{goalId:goal.id},impactDeltaMonths:null,
      })) return;
    } else {
      const g = {...goal,createdAt:new Date().toISOString(),status:'active' as const};
      const initial = alreadySaved > 0 ? addContribution(contributions,{goalId:g.id,amount:String(alreadySaved),date:localIsoDate(today),source:'already saved'}) : undefined;
      if (!saveGoalChoice([...goals,g], {
        kind:'goal_added',label:`Added goal: ${g.label}`,snapshot:{goalCount:goals.length},result:{goalCount:goals.length+1,kind:g.kind,goalId:g.id},impactDeltaMonths:null,
      },initial)) return;
    }
    setForm(null);
  }

  function patch(id: string, p: Partial<Goal>) {
    updateGoals(goals.map(g => g.id === id ? {...g,...p} : g));
  }

  function close(g: Goal, funded: boolean) {
    if (!saveGoalChoice(goals.map(x => x.id === g.id ? {...x,status:funded ? 'archived' : 'cancelled',closedAt:localIsoDate(today),fundingStartMonth:undefined} : x), {
      kind:'goal_removed',label:`${funded ? 'Archived' : 'Cancelled'} goal: ${g.label}`,snapshot:{goal:g},result:{goalId:g.id},impactDeltaMonths:null,
    })) return;
    setOpen(o => ({...o,[g.id]:false}));
  }

  function remove(g: Goal) {
    saveGoalChoice(goals.filter(x => x.id !== g.id), {
      kind:'goal_removed',label:`Deleted goal: ${g.label}`,snapshot:{goal:g},result:{goalId:g.id,deleted:true},impactDeltaMonths:null,
    });
  }

  function commitContributions(next: GoalContributionEntry[]) {
    try {
      if (JSON.stringify(readContributionsClient()) !== JSON.stringify(contributions)) throw new Error('Goal contributions changed elsewhere. Reload before saving.');
      writeContributionsClient(next); setContributions(next); setError('');
    }
    catch (e) { setError((e as Error).message); }
  }

  function cutSpending(g: Goal, monthly: number): boolean {
    const r = commitExpenseReduction({ monthlyDelta: monthly, goalId: g.id, goalLabel: g.label, effectiveMonth: localIsoDate(today).slice(0,7) });
    if (!r) return false;
    setUser(loadProfileClient().user);
    return true;
  }

  function applyTemplate(kind: TemplateKind) {
    const ages: Record<string, number> = { under_25: 22, '25_35': 30, '35_50': 42, '50_plus': 55, '60_plus': 63 };
    const spend = Number(user.fixed_expenses || '0') + Number(user.variable_expenses || '0');
    const t = expandTemplate({ kind, currentAge: user.age_bracket ? ages[user.age_bracket] : 30, monthlyExpenses: spend || undefined });
    if (!updateGoals([...goals, ...t.goals])) return;
    setTemplateNote({ summary: t.summary, caveats: t.caveats });
    setForm(null);
  }

  const openGoals = goals.filter(isOpenGoal);
  const closedGoals = goals.filter((g) => !isOpenGoal(g));
  const ls = openGoals.map((g) => lines[g.id]).filter(Boolean);
  const good = ls.filter((l) => l.state === 'funded' || l.state === 'on_track').length;
  const look = ls.filter((l) => l.state === 'short' || l.state === 'needs_backup' || l.state === 'past').length;
  const saving = ls.filter((l) => l.startIndex === 0 && ['on_track', 'needs_backup', 'short'].includes(l.state));
  const later = ls.filter((l) => l.startIndex > 0).length;
  const monthlyNow = saving.reduce((s, l) => s + l.monthly, 0);
  // When the first goal that waits (for the debts to clear) starts saving.
  const firstLater = ls.filter((l) => l.startIndex > 0).reduce((m, l) => Math.min(m, l.startIndex), Infinity);
  const firstLaterDate = Number.isFinite(firstLater) ? new Date(today.getFullYear(), today.getMonth() + firstLater, 1) : null;
  const firstLaterLabel = firstLaterDate
    ? monthLabel(`${firstLaterDate.getFullYear()}-${String(firstLaterDate.getMonth() + 1).padStart(2, '0')}`)
    : '';
  const totalTarget = ls.reduce((s, l) => s + l.required, 0);

  const formFor = (initial?: Goal) => (
    <GoalForm
      key={initial?.id ?? 'new'}
      initial={initial}
      today={today}
      currency={currency}
      preview={preview}
      onSave={saveDraft}
      onCancel={() => setForm(null)}
    />
  );

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {error && <p role="alert" style={{ color: L_T.negative }}>{error}</p>}
      {openGoals.length > 0 && (
        <LKpi
          mobile={!wide}
          cols={wide ? 4 : 2}
          items={[
            { l: 'GOALS', v: String(openGoals.length), s: `${fmt(totalTarget)} IN ALL` },
            { l: 'ON TRACK', v: String(good), s: 'FROM SPARE CASH', tone: good ? L_T.positive : L_T.ink },
            { l: 'NEED A LOOK', v: String(look), s: look ? 'SHORT OR LATE' : 'NONE', tone: look ? L_T.negative : L_T.ink },
            // What goes to goals this month. ₹0 in red read as a problem
            // when the goals simply start once the debts are paid.
            monthlyNow === 0 && later > 0
              ? {
                  l: 'TO GOALS NOW',
                  v: 'NOT YET',
                  s: `SAVING STARTS ${firstLaterLabel.toUpperCase()}, AFTER DEBTS`,
                  tone: L_T.ink,
                }
              : {
                  l: 'TO GOALS NOW',
                  v: `${fmt(monthlyNow)}/MO`,
                  s: `OF ${fmt(ctx.monthlySurplus)} SPARE${later ? ` · ${later} START${later === 1 ? 'S' : ''} LATER` : ''}`,
                  tone: monthlyNow > ctx.monthlySurplus ? L_T.negative : L_T.ink,
                },
          ]}
        />
      )}

      <section aria-labelledby="goal-ledger">
        <LSectionHeader
          right={form?.mode === 'new' ? undefined : <LBracket accent onClick={() => setForm({ mode: 'new' })}>+ NEW GOAL</LBracket>}
        >
          <span id="goal-ledger">Goals</span>
        </LSectionHeader>

        {form?.mode === 'new' && (
          <div style={{ marginBottom: 14 }}>
            {loaded && goals.length === 0 && (
              <p style={{ margin: '0 0 10px', fontSize: 12, color: L_T.muted }}>
                No goals yet. Add what you&apos;re saving for, and the plan sets money aside for it.
              </p>
            )}
            {formFor()}
          </div>
        )}

        {openGoals.length > 0 && (
          <div role="table" aria-label="Goals" style={{ fontSize: 12 }}>
            {wide && (
              <div role="row" style={{ ...gridWide, padding: '6px 0', borderBottom: `1px solid ${L_T.ink}`, fontSize: 10, color: L_T.muted, letterSpacing: '0.08em', fontWeight: 700 }}>
                <span role="columnheader">#</span>
                <span role="columnheader">GOAL</span>
                <span role="columnheader" style={{ textAlign: 'right' }}>TARGET</span>
                <span role="columnheader">SAVED SO FAR</span>
                <span role="columnheader">BY</span>
                <span role="columnheader" style={{ textAlign: 'right' }}>A MONTH</span>
                <span role="columnheader">STATUS</span>
                <span role="columnheader" />
              </div>
            )}
            {openGoals.map((g, i) => {
              const l = lines[g.id];
              if (!l) return null;
              const isOpen = !!open[g.id];
              const editing = form?.mode === 'edit' && form.id === g.id;
              return (
                <Fragment key={g.id}>
                  <GoalRow
                    i={i}
                    goal={g}
                    line={l}
                    wide={wide}
                    today={today}
                    fmt={fmt}
                    isOpen={isOpen}
                    onOpen={() => setOpen((o) => ({ ...o, [g.id]: !isOpen }))}
                    onEdit={() => setForm(editing ? null : { mode: 'edit', id: g.id })}
                    onClose={() => close(g, l.state === 'funded')}
                  />
                  {editing && <div style={{ padding: '10px 0' }}>{formFor(g)}</div>}
                  {isOpen && !editing && (
                    <div style={{ padding: '12px 14px', background: L_T.paper, borderBottom: `1px dashed ${L_T.ruleSoft}`, ...(g.priorityBump ? lStrip('accent') : null) }}>
                      <GoalDetail
                        goal={g}
                        line={l}
                        currency={currency}
                        today={today}
                        planProjects={ctx.planProjects}
                        contributions={contributions.filter((c) => c.goalId === g.id)}
                        indicativeRate={indicativeRate}
                        indicativeBank={indicativeBank}
                        totalExpenses={ctx.totalExpenses}
                        onPatch={(p) => patch(g.id, p)}
                        onAddMoney={(amount) =>
                          commitContributions(addContribution(contributions, { goalId: g.id, amount, date: localIsoDate(new Date()), source: 'added on Goals' }))
                        }
                        onRemoveMoney={(id) => commitContributions(removeContribution(contributions, id))}
                        onCutSpending={(m) => cutSpending(g, m)}
                      />
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        )}

        {closedGoals.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12 }}>
            <LBracket onClick={() => setShowClosed((s) => !s)}>
              {showClosed ? '−' : '+'} CLOSED · {closedGoals.length}
            </LBracket>
            {showClosed &&
              closedGoals.map((g) => (
                <div key={g.id} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline', padding: '8px 0', borderBottom: `1px dashed ${L_T.faint}` }}>
                  <span style={{ fontWeight: 700, flex: '1 1 180px', color: L_T.muted }}>{g.label}</span>
                  <span style={{ fontSize: 10, letterSpacing: '0.12em', fontWeight: 700, color: L_T.muted }}>
                    {g.status === 'archived' ? 'ARCHIVED' : 'CANCELLED'}
                    {g.closedAt ? ` ${g.closedAt}` : ''}
                  </span>
                  <span style={{ color: L_T.muted }}>{fmt(saved[g.id] ?? 0)} put in</span>
                  <span style={{ display: 'inline-flex', gap: 10 }}>
                    <LBracket onClick={() => patch(g.id, { status: 'active', closedAt: undefined })} label={`Reopen ${g.label}`}>
                      REOPEN
                    </LBracket>
                    <LBracket onClick={() => remove(g)} label={`Delete ${g.label}`}>
                      DELETE
                    </LBracket>
                  </span>
                </div>
              ))}
          </div>
        )}

        {templateNote && (
          <div role="status" style={{ marginTop: 12, fontSize: 12, lineHeight: 1.6, padding: '10px 12px', ...lStrip('accent'), background: L_T.paper }}>
            <strong>{templateNote.summary}</strong>
            {templateNote.caveats.map((c) => (
              <div key={c} style={{ color: L_T.muted }}>· {c}</div>
            ))}
            <LBracket onClick={() => setTemplateNote(null)}>OK</LBracket>
          </div>
        )}

        {/* Rows 14px apart, so each bracket's hit area stays its own. */}
        <div style={{ marginTop: 14, fontSize: 11, color: L_T.muted, display: 'flex', gap: '14px 10px', flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span>Or start from a template:</span>
          {TEMPLATE_CATALOGUE.map((t) => (
            <LBracket key={t.kind} onClick={() => applyTemplate(t.kind)} label={`${t.label}: ${t.description}`}>
              {t.label.toUpperCase()}
            </LBracket>
          ))}
        </div>
      </section>
    </div>
  );
}

function GoalRow({
  i,
  goal,
  line,
  wide,
  today,
  fmt,
  isOpen,
  onOpen,
  onEdit,
  onClose,
}: {
  i: number;
  goal: Goal;
  line: GoalLine;
  wide: boolean;
  today: Date;
  fmt: (n: number | string) => string;
  isOpen: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onClose: () => void;
}) {
  const tone = goalStateTone(line.state);
  const toneColor = tone ? TONE[tone] : L_T.muted;
  const funded = line.state === 'funded';
  const rowStyle: CSSProperties = {
    padding: '10px 0 10px 8px',
    borderBottom: `1px dashed ${L_T.faint}`,
    ...(goal.priorityBump ? lStrip('accent') : null),
  };
  const name = (
    <span style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
      {goal.priorityBump && <span style={{ color: L_T.accent }} aria-label="Saved for first">★ </span>}
      {goal.label || 'Unnamed goal'}
    </span>
  );
  const start = line.startIndex > 0 ? new Date(today.getFullYear(), today.getMonth() + line.startIndex, 1) : null;
  const monthly =
    funded || line.state === 'no_amount' ? (
      <span style={{ color: L_T.muted }}>—</span>
    ) : (
      <span>
        <span style={{ fontWeight: 700, color: line.state === 'short' ? L_T.negative : L_T.ink }}>{fmt(line.monthly)}</span>
        {start && (
          <span style={{ display: 'block', fontSize: 10, color: L_T.muted }}>
            from {monthLabel(`${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`)}
          </span>
        )}
      </span>
    );
  const status = (
    <span style={{ fontSize: 9, letterSpacing: '0.12em', fontWeight: 700, color: toneColor }}>{GOAL_STATE_LABEL[line.state]}</span>
  );
  const actions = (
    <span style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap', justifyContent: wide ? 'flex-end' : 'flex-start' }}>
      <LBracket accent onClick={onOpen} label={`${isOpen ? 'Close' : 'Open'} ${goal.label}`}>
        {isOpen ? 'CLOSE' : 'OPEN'}
      </LBracket>
      <LBracket onClick={onEdit} label={`Edit ${goal.label}`}>
        EDIT
      </LBracket>
      <LBracket onClick={onClose} label={`${funded ? 'Archive' : 'Cancel'} ${goal.label}`}>
        {funded ? 'ARCHIVE' : 'CANCEL GOAL'}
      </LBracket>
    </span>
  );
  const pct = Math.round(Math.max(0, Math.min(100, line.pct)));
  // A real bar the width of its column: the 8-character text bar sat
  // squeezed under the amount and was easy to miss.
  const progress = (
    <span
      role="img"
      aria-label={`${pct}% saved`}
      style={{ display: 'block', height: 6, marginTop: 5, background: L_T.ruleSoft, maxWidth: wide ? undefined : 280 }}
    >
      <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: funded ? L_T.positive : L_T.ink }} />
    </span>
  );

  if (wide) {
    return (
      <div role="row" style={{ ...gridWide, ...rowStyle }}>
        <span role="cell" style={{ color: L_T.muted }}>{String(i + 1).padStart(2, '0')}</span>
        <span role="cell">{name}</span>
        <span role="cell" style={{ textAlign: 'right' }}>{line.required > 0 ? fmt(line.required) : '—'}</span>
        <span role="cell">
          <span style={{ display: 'block' }}>
            <b>{fmt(line.saved)}</b>
            {line.required > 0 && <span style={{ color: L_T.muted }}> · {pct}%</span>}
          </span>
          {line.required > 0 && progress}
        </span>
        <span role="cell">{monthLabel(goal.targetMonth).toUpperCase()}</span>
        <span role="cell" style={{ textAlign: 'right' }}>{monthly}</span>
        <span role="cell">{status}</span>
        <span role="cell" style={{ textAlign: 'right' }}>{actions}</span>
      </div>
    );
  }
  return (
    <div role="row" style={{ ...gridNarrow, ...rowStyle }}>
      <span role="cell" style={{ minWidth: 0 }}>
        {name}
        <span style={{ display: 'block', fontSize: 11, color: L_T.muted, marginTop: 2 }}>
          {fmt(line.saved)} of {line.required > 0 ? fmt(line.required) : '—'}
          {line.required > 0 ? ` (${pct}%)` : ''} · by {monthLabel(goal.targetMonth)}
        </span>
        {line.required > 0 && progress}
        <span style={{ display: 'block', marginTop: 6 }}>{actions}</span>
      </span>
      <span role="cell" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <span style={{ display: 'block' }}>{monthly}</span>
        {!funded && line.state !== 'no_amount' && <span style={{ display: 'block', fontSize: 9, color: L_T.muted }}>A MONTH</span>}
        {status}
      </span>
    </div>
  );
}
