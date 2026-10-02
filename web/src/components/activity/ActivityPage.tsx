'use client';

/**
 * Activity (REDESIGN R4): everything you've paid or changed, month by
 * month, and one dialog to log the next thing. The current month lists
 * what's due and not logged yet, each a tap from PAID. Older months fold
 * away so the page stays short as the ledger grows.
 *
 * Entries live in this browser (lib/activity, lib/monthly-spend) and a
 * cookie the plan reads (lib/activity-cookie); life events in their own
 * cookie (lib/lifecycle-events). Every save re-runs the plan.
 */
import { useEffect, useMemo, useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import type { PlanRunArgs, UserPayload } from '@/lib/api';
import type { StrategyName } from '@/lib/strategy';
import {
  addActivityEntry,
  readActivityClient,
  removeActivityEntry,
  sortActivityNewestFirst,
  writeActivityClient,
  type ActivityEntry,
} from '@/lib/activity';
import { syncActivityCookieClient } from '@/lib/activity-cookie';
import { alignToLoans } from '@/lib/loan-ids';
import {
  addMonthlySpend,
  readMonthlySpendClient,
  writeMonthlySpendClient,
  type MonthlySpendEntry,
} from '@/lib/monthly-spend';
import { addLifecycleEvent, readLifecycleClient, writeLifecycleClient, type LifecycleEvent } from '@/lib/lifecycle-events';
import { commitLifecycle } from '@/lib/commit-lifecycle';
import { loadProfileClient, saveProfileClient } from '@/lib/user-store';
import { getCountryToday, localIsoDate, MONTH_NAMES_SHORT } from '@/lib/today';
import { useWidth } from '@/lib/use-width';
import { LBracket, LSectionHeader, L_T } from '@/components/ledger/primitives';
import { buildHistory, type HistoryRow, type MonthGroup, type Tone } from './history';
import { LogDialog, type LogInitial, type LogSave } from './LogDialog';

const TONE: Record<Tone, string> = {
  positive: L_T.positive,
  negative: L_T.negative,
  muted: L_T.muted,
  ink: L_T.ink,
  accent: L_T.accent,
};

export function ActivityPage({
  user,
  runArgs,
  strategy,
}: {
  user: UserPayload;
  runArgs: PlanRunArgs | null;
  strategy: StrategyName;
}) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const today = localIsoDate(getCountryToday(user.country));
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [spend, setSpend] = useState<MonthlySpendEntry[]>([]);
  const [life, setLife] = useState<LifecycleEvent[]>([]);
  const [dialog, setDialog] = useState<LogInitial | null>(null);
  const [said, setSaid] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [width, ref] = useWidth(900);
  const wide = width >= 720;

  useEffect(() => {
    const read = () => {
      setEntries(alignToLoans(readActivityClient(), user.loans));
      setSpend(readMonthlySpendClient());
      setLife(readLifecycleClient());
    };
    read();
    setReady(true);
    // `?log=payment&loan=2` (from Home's nudges) opens the dialog.
    const q = new URLSearchParams(window.location.search);
    const log = q.get('log');
    if (log === 'payment' || log === 'rate' || log === 'pay' || log === 'spending' || log === 'loan') {
      const loan = Number(q.get('loan'));
      setDialog({ type: log, ...(Number.isInteger(loan) && q.get('loan') !== null ? { loanIndex: loan } : {}) });
    }
    // The cookie the plan reads follows what this browser holds.
    syncActivityCookieClient(alignToLoans(readActivityClient(), user.loans), user.loans, user.country);
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'finoptima_activity' || e.key === 'finoptima_monthly_spend') read();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user.loans, user.country]);

  const valid = useMemo(
    () => sortActivityNewestFirst(entries).filter((e) => e.loanIndex >= 0 && e.loanIndex < user.loans.length),
    [entries, user.loans.length],
  );
  const months = useMemo(
    () => buildHistory({ user, entries: valid, spend, life, today }),
    [user, valid, spend, life, today],
  );
  // The two latest months start open; older ones folded.
  const isOpen = (m: MonthGroup, i: number) => open[m.month] ?? i < 2;

  function rerun(message: string) {
    setSaid(message);
    setError('');
    startTransition(() => router.refresh());
  }

  function saveEntries(next: ActivityEntry[], message: string) {
    setEntries(next);
    writeActivityClient(next);
    syncActivityCookieClient(next, user.loans, user.country);
    rerun(message);
  }

  function save(s: LogSave, message: string) {
    try {
      if (s.kind === 'entry') {
        const next = s.replaces
          ? entries.map((e) => (e.id === s.replaces ? { ...s.draft, id: e.id, loggedAt: e.loggedAt } : e))
          : addActivityEntry(entries, s.draft, user.loans);
        saveEntries(next, message);
      } else if (s.kind === 'life') {
        const before = new Set(readLifecycleClient().map((e) => e.id));
        let next = addLifecycleEvent(readLifecycleClient(), s.draft);
        writeLifecycleClient(next);
        // A change that has already happened goes straight into the profile.
        const added = next.find((e) => !before.has(e.id));
        if (added && added.effectiveDate <= today) next = commitLifecycle(added.id, 'confirmed');
        setLife(next);
        rerun(message);
      } else if (s.kind === 'spent') {
        const next = addMonthlySpend(spend, { monthIso: s.month, spent: s.amount });
        writeMonthlySpendClient(next);
        setSpend(next);
        setSaid(message);
      } else {
        const stored = loadProfileClient();
        const ok = saveProfileClient({ ...stored, user: { ...stored.user, fixed_expenses: s.amount, variable_expenses: '0' } });
        if (!ok) throw new Error('Couldn’t save the profile in this browser.');
        rerun(message);
      }
      setDialog(null);
    } catch (e) {
      setError((e as Error).message);
      setDialog(null);
    }
  }

  function act(row: HistoryRow, action: 'paid' | 'other' | 'edit' | 'undo' | 'happened') {
    const r = row.ref;
    try {
      if (r.kind === 'due' && action === 'paid') {
        saveEntries(
          addActivityEntry(
            entries,
            { loanIndex: r.loanIndex, kind: 'paid_full', date: today, amount: r.amount, scheduledEmi: r.amount },
            user.loans,
          ),
          `${row.target}: ${row.planned} paid.`,
        );
      } else if (r.kind === 'due' && action === 'other') {
        setDialog({ type: 'payment', loanIndex: r.loanIndex, status: 'part' });
      } else if (r.kind === 'entry' && action === 'edit') {
        const entry = entries.find((e) => e.id === r.id);
        if (entry) setDialog({ edit: entry });
      } else if (r.kind === 'entry' && action === 'undo') {
        saveEntries(removeActivityEntry(entries, r.id), `${row.target}: entry removed.`);
      } else if (r.kind === 'spend' && action === 'undo') {
        const next = spend.filter((e) => e.monthIso !== r.month);
        writeMonthlySpendClient(next);
        setSpend(next);
        setSaid('Spending entry removed.');
      } else if (r.kind === 'life') {
        setLife(commitLifecycle(r.id, action === 'happened' ? 'confirmed' : 'planned'));
        rerun(action === 'happened' ? `${row.type.toLowerCase()} applied to your profile.` : `${row.type.toLowerCase()} undone; it’s planned again on Plan.`);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function markAll(m: MonthGroup) {
    let next = entries;
    for (const row of m.rows) {
      if (row.ref.kind !== 'due' || row.ref.card) continue;
      next = addActivityEntry(
        next,
        { loanIndex: row.ref.loanIndex, kind: 'paid_full', date: today, amount: row.ref.amount, scheduledEmi: row.ref.amount },
        user.loans,
      );
    }
    saveEntries(next, 'EMIs marked paid.');
  }

  function jump(m: MonthGroup, i: number) {
    const opening = !isOpen(m, i);
    setOpen({ ...open, [m.month]: opening });
    if (opening) requestAnimationFrame(() => document.getElementById(`month-${m.month}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  const count = valid.length + Object.keys(spend.reduce<Record<string, 1>>((a, e) => ({ ...a, [e.monthIso]: 1 }), {})).length;

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section aria-labelledby="activity-h">
        <LSectionHeader right={<LBracket accent onClick={() => setDialog({})}>+ LOG AN ENTRY</LBracket>}>
          <span id="activity-h">Activity · {count} {count === 1 ? 'entry' : 'entries'}</span>
        </LSectionHeader>
        <p style={{ margin: '0 0 8px', fontSize: 12, color: L_T.inkSoft, lineHeight: 1.6 }}>
          What you paid and what changed, by month. Each entry re-runs the plan from what really happened.
        </p>
        <p role="status" style={{ margin: 0, fontSize: 12, minHeight: said || refreshing ? undefined : 0, color: L_T.positive }}>
          {said}
          {refreshing && <span style={{ color: L_T.muted }}> Re-running the plan…</span>}
        </p>
        {error && (
          <p role="alert" style={{ margin: '4px 0 0', fontSize: 12, color: L_T.negative }}>
            {error}
          </p>
        )}
      </section>

      {ready && months.length > 1 && (
        <nav
          aria-label="Months"
          style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'baseline', padding: '8px 0', borderTop: `1px dashed ${L_T.faint}`, borderBottom: `1px dashed ${L_T.faint}` }}
        >
          <span style={{ fontSize: 9, letterSpacing: '0.14em', color: L_T.muted, marginRight: 4 }}>JUMP →</span>
          {months.map((m, i) => (
            <LBracket key={m.month} active={isOpen(m, i)} onClick={() => jump(m, i)} label={`${m.label}, ${m.rows.length} rows, ${isOpen(m, i) ? 'open: fold it' : 'folded: open it'}`}>
              {m.label} · {m.rows.length}
            </LBracket>
          ))}
        </nav>
      )}

      {ready &&
        months.map((m, i) => (
          <Month
            key={m.month}
            m={m}
            open={isOpen(m, i)}
            wide={wide}
            onToggle={() => setOpen({ ...open, [m.month]: !isOpen(m, i) })}
            onAct={act}
            onMarkAll={() => markAll(m)}
          />
        ))}

      {ready && user.loans.length === 0 && spend.length === 0 && (
        <p style={{ margin: 0, fontSize: 12, color: L_T.muted }}>
          No loans on file. Log your spending here, or add a loan in Profile to track its payments.
        </p>
      )}

      {dialog && (
        <LogDialog
          user={user}
          today={today}
          runArgs={runArgs}
          strategy={strategy}
          initial={dialog}
          onSave={save}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function Month({
  m,
  open,
  wide,
  onToggle,
  onAct,
  onMarkAll,
}: {
  m: MonthGroup;
  open: boolean;
  wide: boolean;
  onToggle: () => void;
  onAct: (row: HistoryRow, action: 'paid' | 'other' | 'edit' | 'undo' | 'happened') => void;
  onMarkAll: () => void;
}) {
  const due = m.rows.filter((r) => r.pending);
  const emisDue = due.filter((r) => r.ref.kind === 'due' && !r.ref.card).length;
  const logged = m.rows.length - due.length;
  return (
    <section id={`month-${m.month}`} aria-labelledby={`month-${m.month}-h`} style={{ scrollMarginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, borderTop: `2px solid ${L_T.ink}`, padding: '10px 0 6px' }}>
        <h3 id={`month-${m.month}-h`} style={{ margin: 0, fontSize: 12, letterSpacing: '0.18em', fontWeight: 700 }}>
          $ {m.label}
          {m.current && <span style={{ color: L_T.accent }}> · THIS MONTH</span>}
        </h3>
        <span style={{ display: 'inline-flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          {m.rows.length > 0 && (
            <span style={{ fontSize: 10, letterSpacing: '0.1em', fontWeight: 700, color: due.length ? L_T.accent : L_T.positive }}>
              {due.length ? `${due.length} TO LOG` : `${logged} LOGGED`}
            </span>
          )}
          {open && emisDue > 1 && (
            <LBracket accent onClick={onMarkAll}>
              MARK {emisDue} EMIS PAID
            </LBracket>
          )}
          <LBracket onClick={onToggle} label={`${open ? 'Fold' : 'Open'} ${m.label}`}>
            {open ? '↑ FOLD' : '↓ OPEN'}
          </LBracket>
        </span>
      </div>
      {open &&
        (m.rows.length === 0 ? (
          <p style={{ margin: 0, padding: '8px 0', fontSize: 12, color: L_T.muted }}>Nothing logged this month yet.</p>
        ) : (
          <div role="table" aria-label={`${m.label} activity`} style={{ fontSize: 11 }}>
            {wide && (
              <div role="row" style={{ ...gridWide, borderTop: `1px solid ${L_T.ink}`, borderBottom: `1px dashed ${L_T.faint}` }}>
                {['DATE', 'WHAT', 'PLANNED', 'PAID', 'STATUS', 'EFFECT', ''].map((h, i) => (
                  <span key={i} role="columnheader" style={{ padding: '6px 0', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: L_T.muted, textAlign: i >= 2 && i <= 3 ? 'right' : 'left' }}>
                    {h}
                  </span>
                ))}
              </div>
            )}
            {m.rows.map((r) => (
              <Row key={r.key} r={r} wide={wide} onAct={onAct} />
            ))}
          </div>
        ))}
    </section>
  );
}

const gridWide: CSSProperties = {
  display: 'grid',
  // Fixed outer columns: each row is its own grid, so they must not size to content.
  gridTemplateColumns: '64px minmax(0, 2fr) 96px 96px 104px minmax(0, 1.4fr) 150px',
  columnGap: 12,
  alignItems: 'baseline',
};
const gridNarrow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '44px minmax(0, 1fr) auto',
  columnGap: 10,
  alignItems: 'baseline',
};

function DateCell({ date, pending }: { date: string; pending?: boolean }) {
  const mon = MONTH_NAMES_SHORT[Number(date.slice(5, 7)) - 1].toUpperCase();
  if (date.length < 10) {
    return <span style={{ fontSize: 9, letterSpacing: '0.12em', color: L_T.muted, fontWeight: 600 }}>{pending ? 'DUE' : mon}</span>;
  }
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{date.slice(8, 10)}</span>
      <span style={{ fontSize: 9, color: L_T.muted, letterSpacing: '0.12em', marginLeft: 4, fontWeight: 600 }}>{mon}</span>
    </span>
  );
}

function Actions({ r, onAct }: { r: HistoryRow; onAct: (row: HistoryRow, action: 'paid' | 'other' | 'edit' | 'undo' | 'happened') => void }) {
  const what = `${r.target}, ${r.date}`;
  return (
    <span style={{ display: 'inline-flex', gap: 10, flexWrap: 'wrap' }}>
      {r.ref.kind === 'due' && (
        <>
          <LBracket accent onClick={() => onAct(r, 'paid')} label={`${r.target}: paid ${r.planned}`}>
            PAID
          </LBracket>
          <LBracket onClick={() => onAct(r, 'other')} label={`${r.target}: paid part, missed or more`}>
            OTHER
          </LBracket>
        </>
      )}
      {r.ref.kind === 'entry' && (
        <>
          <LBracket onClick={() => onAct(r, 'edit')} label={`Change ${what}`}>
            EDIT
          </LBracket>
          <LBracket onClick={() => onAct(r, 'undo')} label={`Remove ${what}`}>
            UNDO
          </LBracket>
        </>
      )}
      {r.ref.kind === 'spend' && (
        <LBracket onClick={() => onAct(r, 'undo')} label={`Remove spending for ${what}`}>
          UNDO
        </LBracket>
      )}
      {r.ref.kind === 'life' &&
        (r.ref.due ? (
          <LBracket accent onClick={() => onAct(r, 'happened')} label={`${r.target}: it happened`}>
            IT HAPPENED
          </LBracket>
        ) : (
          <LBracket onClick={() => onAct(r, 'undo')} label={`Undo ${r.target}`}>
            UNDO
          </LBracket>
        ))}
    </span>
  );
}

function Row({ r, wide, onAct }: { r: HistoryRow; wide: boolean; onAct: (row: HistoryRow, action: 'paid' | 'other' | 'edit' | 'undo' | 'happened') => void }) {
  const rowStyle: CSSProperties = {
    padding: '9px 0',
    borderBottom: `1px dashed ${L_T.faint}`,
    background: r.pending ? 'rgba(255, 248, 211, 0.6)' : 'transparent',
  };
  const what = (
    <span style={{ minWidth: 0 }}>
      <span style={{ display: 'block', fontSize: 9, letterSpacing: '0.14em', fontWeight: 700, color: L_T.accent }}>{r.type}</span>
      <span style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{r.target}</span>
      {r.note && <span style={{ display: 'block', fontSize: 10, color: L_T.muted, marginTop: 2 }}>{r.note}</span>}
    </span>
  );
  const status = (
    <span style={{ fontSize: 9, letterSpacing: '0.12em', fontWeight: 700, color: TONE[r.tone] }}>{r.status}</span>
  );
  const effect = r.effect ? <span style={{ fontWeight: 600, color: TONE[r.effect.tone] }}>{r.effect.text}</span> : null;

  if (wide) {
    return (
      <div role="row" style={{ ...gridWide, ...rowStyle }}>
        <span role="cell"><DateCell date={r.date} pending={r.pending} /></span>
        <span role="cell">{what}</span>
        <span role="cell" style={{ textAlign: 'right', color: L_T.muted }}>{r.planned ?? '—'}</span>
        <span role="cell" style={{ textAlign: 'right', fontWeight: 700, color: TONE[r.tone] }}>{r.actual ?? '—'}</span>
        <span role="cell">{status}</span>
        <span role="cell">{effect ?? <span style={{ color: L_T.muted }}>—</span>}</span>
        <span role="cell" style={{ textAlign: 'right' }}><Actions r={r} onAct={onAct} /></span>
      </div>
    );
  }
  // "planned ₹13,700" only says something when it isn't what was paid.
  const differs = !!r.planned && !r.pending && r.planned !== r.actual;
  return (
    <div role="row" style={{ ...gridNarrow, ...rowStyle }}>
      <span role="cell"><DateCell date={r.date} pending={r.pending} /></span>
      <span role="cell" style={{ minWidth: 0 }}>
        {what}
        {(differs || effect) && (
          <span style={{ display: 'block', marginTop: 3, fontSize: 10, color: L_T.muted }}>
            {differs && `planned ${r.planned}`}
            {differs && effect && ' · '}
            {effect}
          </span>
        )}
        <span style={{ display: 'block', marginTop: 6 }}><Actions r={r} onAct={onAct} /></span>
      </span>
      <span role="cell" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <span style={{ display: 'block', fontWeight: 700, color: r.pending ? L_T.ink : TONE[r.tone] }}>{r.actual ?? r.planned ?? ''}</span>
        {status}
      </span>
    </div>
  );
}
