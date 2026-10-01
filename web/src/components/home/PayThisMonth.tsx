'use client';

/**
 * Home's "Pay this month" register (REDESIGN R2.2): the plan's payments for
 * this month, ticked off where they're shown. MARK PAID records the row in
 * Activity as paid in full; PARTIAL / OTHER takes the amount actually sent
 * (or "didn't pay"). A row marked here can be undone here; one logged in
 * Activity is shown as logged and left alone.
 *
 * The plan already counts this month's payments, so marking one paid
 * doesn't move the plan. A planned extra marked paid comes off the balance
 * once the month is over (see `plannedExtra` in lib/activity).
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { Country, LoanPayload } from '@/lib/api';
import { formatCurrencyWhole } from '@/lib/api';
import {
  addActivityEntry,
  readActivityClient,
  writeActivityClient,
  type ActivityEntry,
  type ActivityKind,
} from '@/lib/activity';
import { syncActivityCookieClient } from '@/lib/activity-cookie';
import { alignToLoans } from '@/lib/loan-ids';
import { MONTH_NAMES_SHORT, localIsoDate } from '@/lib/today';
import { userDefaultCurrency } from '@/lib/currency';
import type { PayRow, PayThisMonth as PayData } from '@/lib/pay-this-month';
import { Field } from '@/components/ToolPrimitives';
import { LAllocationBar, LBracket, LSectionHeader, L_T, lStrip } from '@/components/ledger/primitives';

/** Fund and goal ticks, per month: they aren't loan payments, so they
 *  aren't Activity entries. */
const SET_ASIDE_KEY = 'finoptima_set_aside';

type Status = { tag: 'PAID' | 'PARTIAL' | 'MISSED'; amount: number; date: string; undoable: boolean };

export function PayThisMonth({
  data,
  loans,
  country,
  monthLabel,
  reason,
  alert,
}: {
  data: PayData;
  /** The saved loans (as Activity stores them), for entry ids. */
  loans: LoanPayload[];
  country: Country;
  /** "October 2026". */
  monthLabel: string;
  /** Why the top extra goes where it does, under that row. */
  reason?: { key: string; text: string };
  /** Short of money this month (or later): said above the rows. */
  alert?: string;
}) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [ticked, setTicked] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const today = localIsoDate(new Date());
  const month = today.slice(0, 7);
  const userCcy = userDefaultCurrency(country);
  const fmt = (v: number, ccy = userCcy) => formatCurrencyWhole(Math.round(v), ccy);

  useEffect(() => {
    const read = () => {
      setEntries(alignToLoans(readActivityClient(), loans));
      try {
        const t = JSON.parse(window.localStorage.getItem(SET_ASIDE_KEY) || 'null');
        setTicked(t && t.month === month && Array.isArray(t.keys) ? t.keys : []);
      } catch {
        setTicked([]);
      }
    };
    read();
    setReady(true);
    // Another tab (or Activity) logged something.
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'finoptima_activity' || e.key === SET_ASIDE_KEY) read();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commit(next: ActivityEntry[]) {
    setEntries(next);
    writeActivityClient(next);
    syncActivityCookieClient(next, loans, country);
  }

  function statusOf(row: PayRow): Status | null {
    if (row.loanIndex === null) {
      return ticked.includes(row.key) ? { tag: 'PAID', amount: row.amount, date: today, undoable: true } : null;
    }
    const mine = entries.filter((e) => e.loanIndex === row.loanIndex && e.date.slice(0, 7) === month);
    if (mine.length === 0) return null;
    const amount = mine.reduce((s, e) => s + Number(e.amount || 0), 0);
    const date = mine.map((e) => e.date).sort().slice(-1)[0];
    const undoable = mine.every((e) => e.via === 'home');
    if (mine.some((e) => e.kind === 'missed') && amount === 0) return { tag: 'MISSED', amount, date, undoable };
    // Short of the EMI or card minimum: what was sent still counts, but
    // the rest is overdue.
    if (mine.some((e) => e.kind === 'paid_partial' || e.kind === 'missed') && amount < row.minimum) {
      return { tag: 'PARTIAL', amount, date, undoable };
    }
    return { tag: 'PAID', amount, date, undoable };
  }

  function log(row: PayRow, kind: ActivityKind, paid: number) {
    const extra = Math.max(0, paid - row.minimum);
    commit(
      addActivityEntry(
        entries,
        {
          loanIndex: row.loanIndex!,
          kind,
          date: today,
          amount: String(paid),
          scheduledEmi: String(row.minimum),
          // The part of the plan's own extra this covers waits for next
          // month in the plan (it's already in this month's).
          ...(kind === 'paid_extra' && row.extra > 0 ? { plannedExtra: String(Math.min(extra, row.extra)) } : {}),
          via: 'home',
        },
        loans,
      ),
    );
  }

  function markPaid(row: PayRow) {
    if (row.loanIndex === null) {
      const next = [...ticked, row.key];
      setTicked(next);
      try {
        window.localStorage.setItem(SET_ASIDE_KEY, JSON.stringify({ month, keys: next }));
      } catch {
        /* the tick lasts this visit */
      }
      setSaid(`${row.name}: ${fmt(row.amount)} set aside.`);
      return;
    }
    log(row, row.extra > 0 ? 'paid_extra' : 'paid_full', row.amount);
    setSaid(`${row.name}: marked paid, ${fmt(row.amount, row.currency)}. Recorded in Activity.`);
  }

  function undo(row: PayRow) {
    if (row.loanIndex === null) {
      const next = ticked.filter((k) => k !== row.key);
      setTicked(next);
      try {
        window.localStorage.setItem(SET_ASIDE_KEY, JSON.stringify({ month, keys: next }));
      } catch {
        /* nothing stored */
      }
    } else {
      commit(
        entries.filter((e) => !(e.loanIndex === row.loanIndex && e.date.slice(0, 7) === month && e.via === 'home')),
      );
    }
    setSaid(`${row.name}: back to not paid.`);
  }

  function openOther(row: PayRow) {
    setOpen(row.key);
    setAmount('');
    setError(null);
  }

  function saveOther(row: PayRow, missed = false) {
    if (missed) {
      log(row, 'missed', 0);
      setSaid(`${row.name}: recorded as not paid this month.`);
      setOpen(null);
      return;
    }
    const paid = Math.round(Number(amount));
    if (!(paid > 0)) {
      setError(`Enter what you paid, for example ${fmt(row.minimum || row.amount, row.currency)}.`);
      return;
    }
    const kind: ActivityKind = paid < row.minimum ? 'paid_partial' : paid > row.minimum ? 'paid_extra' : 'paid_full';
    log(row, kind, paid);
    setSaid(
      `${row.name}: ${fmt(paid, row.currency)} recorded${paid < row.minimum ? `, ${fmt(row.minimum - paid, row.currency)} short of the minimum` : ''}.`,
    );
    setOpen(null);
  }

  const statuses = data.rows.map((r) => (ready ? statusOf(r) : null));
  // What's been sent so far, in the user's currency (each row's own rate).
  const paidUser = data.rows.reduce((s, r, i) => {
    const st = statuses[i];
    return st ? s + (r.amount > 0 ? (st.amount / r.amount) * r.amountUser : 0) : s;
  }, 0);
  const toGo = statuses.filter((s) => !s).length;
  const firstExtra = data.rows.find((r) => r.kind === 'extra' || r.kind === 'clears');

  return (
    <section aria-labelledby="home-pay">
      <LSectionHeader
        right={
          <span style={{ fontSize: 11, color: L_T.muted, letterSpacing: '0.08em' }}>
            {ready ? `${fmt(paidUser)} OF ${fmt(data.total)} PAID · ${toGo === 0 ? 'ALL DONE' : `${toGo} TO GO`}` : ' '}
          </span>
        }
      >
        <span id="home-pay">Pay this month · {monthLabel}</span>
      </LSectionHeader>
      <p style={{ margin: '0 0 10px', fontSize: 12, color: L_T.muted, lineHeight: 1.6 }}>
        What the plan pays this month. Mark each one once it has gone out; it&apos;s recorded in Activity.
      </p>
      {alert && (
        <p style={{ margin: '0 0 12px', padding: '8px 12px', fontSize: 12, lineHeight: 1.6, ...lStrip('negative') }}>
          {alert}
        </p>
      )}
      <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 12, color: L_T.positive, minHeight: said ? 18 : 0 }}>
        {said}
      </p>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: `2px solid ${L_T.ink}` }}>
        {data.rows.map((row, i) => {
          const st = statuses[i];
          const done = st?.tag === 'PAID';
          const foreign = row.currency !== userCcy;
          return (
            <li
              key={row.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '28px minmax(0, 1fr) auto',
                columnGap: 10,
                rowGap: 6,
                padding: '12px 10px 12px 8px',
                borderBottom: `1px dashed ${L_T.ruleSoft}`,
                fontSize: 12,
                ...(row === firstExtra && !st ? lStrip('accent') : null),
              }}
            >
              <span style={{ color: L_T.muted, fontVariantNumeric: 'tabular-nums' }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>
                  {row.name}
                  {st && (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 10,
                        letterSpacing: '0.12em',
                        color: st.tag === 'PAID' ? L_T.positive : L_T.negative,
                      }}
                    >
                      · {st.tag === 'MISSED' ? 'NOT PAID' : st.tag}
                      {st.tag !== 'MISSED' && st.amount !== row.amount ? ` ${fmt(st.amount, row.currency)}` : ''} ·{' '}
                      {dayLabel(st.date)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, letterSpacing: '0.1em', color: L_T.muted, marginTop: 3 }}>
                  {kindLine(row, fmt)}
                  {row.dueDay ? ` · DUE ${row.dueDay} ${MONTH_NAMES_SHORT[Number(month.slice(5)) - 1].toUpperCase()}` : ''}
                </div>
                {reason && reason.key === row.key && !st && (
                  <div style={{ fontSize: 11, color: L_T.muted, marginTop: 4, lineHeight: 1.5 }}>{reason.text}</div>
                )}
              </div>
              <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                <div style={{ fontWeight: 700, fontSize: 14, textDecoration: done ? 'line-through' : 'none', color: done ? L_T.muted : L_T.ink }}>
                  {fmt(row.amount, row.currency)}
                </div>
                {foreign && <div style={{ fontSize: 10, color: L_T.muted }}>≈ {fmt(row.amountUser)}</div>}
              </div>
              <div style={{ gridColumn: '2 / -1', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
                {!ready ? null : st ? (
                  st.undoable ? (
                    <LBracket onClick={() => undo(row)} label={`Undo: ${row.name} not paid`}>
                      UNDO
                    </LBracket>
                  ) : (
                    <LBracket href="/activity#activity-ledger">LOGGED IN ACTIVITY →</LBracket>
                  )
                ) : open === row.key ? null : (
                  <>
                    <LBracket active onClick={() => markPaid(row)} label={`Mark ${row.name} paid, ${fmt(row.amount, row.currency)}`}>
                      {row.loanIndex === null ? 'SET ASIDE' : 'MARK PAID'}
                    </LBracket>
                    {row.loanIndex !== null && (
                      <LBracket onClick={() => openOther(row)} label={`Paid a different amount on ${row.name}`}>
                        PARTIAL / OTHER
                      </LBracket>
                    )}
                  </>
                )}
              </div>
              {open === row.key && (
                <div
                  style={{
                    gridColumn: '2 / -1',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 12,
                    alignItems: 'flex-end',
                    paddingTop: 4,
                  }}
                >
                  <div style={{ flex: '1 1 200px', maxWidth: 260 }}>
                    <Field
                      label={`Paid this month (${row.currency === 'INR' ? '₹' : '$'})`}
                      kind="money"
                      currency={row.currency}
                      value={amount}
                      onChange={(v) => {
                        setAmount(v);
                        setError(null);
                      }}
                      placeholder={row.amount.toLocaleString(row.currency === 'INR' ? 'en-IN' : 'en-US')}
                      error={error}
                    />
                  </div>
                  <span style={{ display: 'flex', gap: 12, flexWrap: 'wrap', paddingBottom: 8 }}>
                    <LBracket active onClick={() => saveOther(row)}>
                      SAVE
                    </LBracket>
                    <LBracket onClick={() => saveOther(row, true)}>I DIDN&apos;T PAY</LBracket>
                    <LBracket onClick={() => setOpen(null)}>CANCEL</LBracket>
                  </span>
                  <div style={{ flexBasis: '100%', fontSize: 11, color: L_T.muted }}>
                    Another date, a late fee from your statement, or the card&apos;s new balance:{' '}
                    <a href="/activity#activity-ledger" style={{ color: L_T.accent }}>
                      log it in Activity
                    </a>
                    .
                  </div>
                </div>
              )}
            </li>
          );
        })}
        <li
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            padding: '10px 10px 10px 46px',
            borderTop: `2px solid ${L_T.ink}`,
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          <span style={{ color: L_T.muted, letterSpacing: '0.1em', fontSize: 10, fontWeight: 400 }}>TOTAL THIS MONTH</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(data.total)}</span>
        </li>
      </ol>
      {data.rows.length > 1 && (
        <div style={{ marginTop: 14 }}>
          <div aria-hidden="true" style={{ fontSize: 10, letterSpacing: '0.12em', color: L_T.muted, marginBottom: 6 }}>
            $ WHERE THIS MONTH&apos;S MONEY GOES
          </div>
          <LAllocationBar
            label="Where this month's money goes"
            height={24}
            segments={data.rows.map((r, i) => ({
              id: r.key,
              label: r.name,
              value: r.amountUser,
              amount: fmt(r.amount, r.currency),
              // Dark fills only, so the white labels stay readable: the
              // extra's loan in the accent (like its row), savings green,
              // the other loans in greys.
              color: r === firstExtra ? L_T.accent : r.loanIndex === null ? L_T.positive : BAR[i % BAR.length],
            }))}
          />
        </div>
      )}
      {data.leftOver > 0 && (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: L_T.muted, lineHeight: 1.6 }}>
          {fmt(data.leftOver)} is left over: no loan costs more than a safe return, so the plan keeps it. Save or invest it.
        </p>
      )}
      <div style={{ marginTop: 10 }}>
        <LBracket href="/plan">WHY THIS ORDER? SEE THE PLAN →</LBracket>
      </div>
    </section>
  );
}

const BAR = ['#2a2a26', '#5e5e58', '#0a0a0a', '#76766f'];

/** The section when there's nothing to tick: details missing, or no plan. */
export function PayNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <LSectionHeader>{title}</LSectionHeader>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: L_T.ink }}>{children}</p>
    </section>
  );
}

function kindLine(row: PayRow, fmt: (v: number, ccy?: PayRow['currency']) => string): string {
  const min = row.loanIndex !== null && row.minimum > 0 ? fmt(row.minimum, row.currency) : '';
  switch (row.kind) {
    case 'emi':
      return 'EMI';
    case 'minimum':
      return 'CARD MINIMUM';
    case 'extra':
      return `${row.minimum > 0 ? `${min} ${row.card ? 'MINIMUM' : 'EMI'} + ` : ''}${fmt(row.extra, row.currency)} EXTRA`;
    case 'clears':
      return 'PAYS IT OFF';
    case 'ef':
      return 'SET ASIDE · UNTIL THE FUND REACHES ITS TARGET';
    case 'goals':
      return 'SET ASIDE · FOR YOUR GOALS';
  }
}

function dayLabel(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTH_NAMES_SHORT[m - 1]?.toUpperCase() ?? ''}`;
}
