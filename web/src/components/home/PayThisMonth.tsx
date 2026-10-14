'use client';

/**
 * Home's "Pay this month" register (REDESIGN R2.2): the plan's payments for
 * this month, ticked off where they're shown. MARK PAID records the row in
 * Activity as paid in full; OTHER AMOUNT takes the amount actually sent
 * (or "didn't pay"). A row marked here can be undone here; one logged in
 * Activity is shown as logged and left alone.
 *
 * The plan already counts this month's payments, so marking one paid
 * doesn't move the plan. A planned extra marked paid comes off the balance
 * once the month is over (see `plannedExtra` in lib/activity).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Country, LoanPayload } from '@/lib/api';
import { formatCurrencyWhole } from '@/lib/api';
import {
  addActivityEntry,
  readActivityClient,
  type ActivityEntry,
  type ActivityKind,
} from '@/lib/activity';
import { commitActivity } from '@/lib/commit-activity';
import { paymentState } from '@/lib/payment-state';
import { loadProfileClient, profileCookieKey, saveProfileClient } from '@/lib/user-store';
import { alignToLoans } from '@/lib/loan-ids';
import { MONTH_NAMES_SHORT, localIsoDate, getCountryToday } from '@/lib/today';
import { userDefaultCurrency } from '@/lib/currency';
import { owedAfterLabel, type PayRow, type PayThisMonth as PayData } from '@/lib/pay-this-month';
import { owedNow } from '@/lib/owed-now';
import { Field } from '@/components/ToolPrimitives';
import { UpiPay } from './UpiPay';
// G7: loan-cleared letter, payday email, answers from the email.
import { LoanCleared } from './LoanCleared';
import { PaydayEmail } from './PaydayEmail';
import { EmailAnswers } from './EmailAnswers';
import { LBracket, LSectionHeader, L_T, lPayBtn, lStrip } from '@/components/ledger/primitives';
import { payoffBreakdown } from '@/lib/schedule-reconcile';
// Fund and goal ticks, per month: they aren't loan payments, so they
// aren't Activity entries.
import { SET_ASIDE_EVENT, SET_ASIDE_KEY } from '@/lib/this-month-progress';


// EMI PAID: the EMI or minimum has gone out, the plan's extra on it hasn't.
type Status = { tag: 'PAID' | 'EMI PAID' | 'PARTIAL' | 'MISSED'; amount: number; date: string; undoable: boolean };

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
  // UPI IDs saved on this page, until Home re-renders with the saved profile.
  const [vpas, setVpas] = useState<Record<number, string>>({});
  // A payoff just marked paid: the celebration and the closure letter.
  const [cleared, setCleared] = useState<PayRow | null>(null);
  const profileAtRead = useRef('');
  const today = localIsoDate(getCountryToday(country));
  const month = today.slice(0, 7);
  const userCcy = userDefaultCurrency(country);
  const fmt = (v: number, ccy = userCcy) => formatCurrencyWhole(Math.round(v), ccy);

  useEffect(() => {
    profileAtRead.current = profileCookieKey();
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
      if (e.key === 'rightdue_activity' || e.key === SET_ASIDE_KEY) read();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener('rightdue:profile-changed', read);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('rightdue:profile-changed', read);
    };
  }, [loans, month]);

  function commit(next: ActivityEntry[]) {
    if (profileCookieKey() !== profileAtRead.current)
      throw new Error('Your profile changed. Refresh Home before logging a payment.');
    if (JSON.stringify(alignToLoans(readActivityClient(), loans)) !== JSON.stringify(entries))
      throw new Error('Activity changed. Refresh Home before logging a payment.');
    commitActivity(next, loadProfileClient().user);
    setEntries(next);
  }

  function statusOf(row: PayRow): Status | null {
    if (row.loanIndex === null) {
      return ticked.includes(row.key) ? { tag: 'PAID', amount: row.amount, date: today, undoable: true } : null;
    }
    const mine = entries.filter((e) => e.loanIndex === row.loanIndex && e.date.slice(0, 7) === month);
    const state = paymentState(mine, row.minimum, row.amount);
    if (state === 'due') return null;
    const amount = mine.reduce((s, e) => s + Number(e.amount || 0), 0);
    const date = mine.map((e) => e.date).sort().slice(-1)[0];
    const undoable = mine.every((e) => e.via === 'home');
    if (state === 'missed') return { tag: 'MISSED', amount, date, undoable };
    // Short of the EMI or card minimum: what was sent still counts, but
    // the rest is overdue.
    if (state === 'part') {
      return { tag: 'PARTIAL', amount, date, undoable };
    }
    if (state === 'emi_paid') return { tag: 'EMI PAID', amount, date, undoable };
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

  /** The extra on a row whose EMI is already recorded: an entry of its own,
   *  all of it principal. As much as the plan put on this loan this month
   *  is already in the plan's first month (`plannedExtra`). */
  function logExtra(row: PayRow, extra: number, paidSoFar: number) {
    const plannedLeft = Math.max(0, row.extra - Math.max(0, paidSoFar - row.minimum));
    commit(
      addActivityEntry(
        entries,
        {
          loanIndex: row.loanIndex!,
          kind: 'paid_extra',
          date: today,
          amount: String(extra),
          scheduledEmi: '0',
          ...(plannedLeft > 0 ? { plannedExtra: String(Math.min(extra, plannedLeft)) } : {}),
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
        window.dispatchEvent(new Event(SET_ASIDE_EVENT));
      } catch {
        /* the tick lasts this visit */
      }
      setSaid(`${row.name}: ${fmt(row.amount)} set aside.`);
      return;
    }
    const already = statusOf(row);
    if (already?.tag === 'EMI PAID') {
      logExtra(row, row.amount - already.amount, already.amount);
      setSaid(`${row.name}: extra marked paid, ${fmt(row.amount - already.amount, row.currency)}. Recorded in Activity.`);
      return;
    }
    log(row, row.extra > 0 ? 'paid_extra' : 'paid_full', row.amount);
    setSaid(`${row.name}: marked paid, ${fmt(row.amount, row.currency)}. Recorded in Activity.`);
    if (row.kind === 'clears') setCleared(row);
  }

  /** Every loan row not yet recorded this month, marked paid in full in one
   *  commit (the payday email's "All paid", confirmed here). */
  function markAllPaid(): boolean {
    try {
      let next = entries;
      for (const row of data.rows) {
        if (row.loanIndex === null || statusOf(row)) continue;
        next = addActivityEntry(
          next,
          {
            loanIndex: row.loanIndex,
            kind: row.extra > 0 ? 'paid_extra' : 'paid_full',
            date: today,
            amount: String(row.amount),
            scheduledEmi: String(row.minimum),
            ...(row.extra > 0 ? { plannedExtra: String(row.extra) } : {}),
            via: 'home',
          },
          loans,
        );
      }
      if (next !== entries) commit(next);
      setSaid('Marked paid from your email answer. Recorded in Activity.');
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  }

  /** Save the lender's UPI ID on the loan (roadmap PR H). */
  function saveVpa(row: PayRow, vpa: string): boolean {
    if (row.loanIndex === null) return false;
    const stored = loadProfileClient();
    const list = stored.user.loans ?? [];
    const at = list.findIndex((l) => (loans[row.loanIndex!]?.id ? l.id === loans[row.loanIndex!].id : false));
    const i = at >= 0 ? at : row.loanIndex;
    if (!list[i]) return false;
    const next = list.map((l, k) => (k === i ? { ...l, upi_vpa: vpa } : l));
    const ok = saveProfileClient({ ...stored, user: { ...stored.user, loans: next } });
    // The profile changed on purpose: payments logged after this are still for this page.
    if (ok) {
      profileAtRead.current = profileCookieKey();
      setVpas((m) => ({ ...m, [row.loanIndex!]: vpa }));
      setSaid(`${row.name}: UPI ID saved.`);
    }
    return ok;
  }

  function undo(row: PayRow) {
    if (row.loanIndex === null) {
      const next = ticked.filter((k) => k !== row.key);
      setTicked(next);
      try {
        window.localStorage.setItem(SET_ASIDE_KEY, JSON.stringify({ month, keys: next }));
        window.dispatchEvent(new Event(SET_ASIDE_EVENT));
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

  function attempt(action: () => void) {
    try { action(); } catch (e) { setError((e as Error).message); setSaid(''); }
  }

  function saveOther(row: PayRow, missed = false) {
    if (missed) {
      log(row, 'missed', 0);
      setSaid(`${row.name}: recorded as not paid this month.`);
      setOpen(null);
      return;
    }
    const paid = Math.round(Number(amount));
    const already = statusOf(row);
    if (already?.tag === 'EMI PAID') {
      if (!(paid > 0)) {
        setError(`Enter the extra you paid, for example ${fmt(row.amount - already.amount, row.currency)}.`);
        return;
      }
      logExtra(row, paid, already.amount);
      setSaid(`${row.name}: ${fmt(paid, row.currency)} extra recorded.`);
      setOpen(null);
      return;
    }
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
  const toGo = statuses.filter((s) => !s || s.tag !== 'PAID').length;
  const firstExtra = data.rows.find((r) => r.kind === 'extra' || r.kind === 'clears');
  // UX50 B-01: one order and one number per loan on Home: this list
  // follows "Your loans and cards" (the order the loans were entered), and
  // each loan carries the number it has there. The extra's row is tagged
  // in words instead of being moved to the top.
  const openNo = new Map<number, number>();
  loans.forEach((l, i) => {
    if (Number(l.outstanding) > 0 && (l.planned_effective_month ?? 1) <= 1) openNo.set(i, openNo.size + 1);
  });
  const order = data.rows
    .map((_, i) => i)
    .sort((a, b) => {
      const ka = data.rows[a].loanIndex ?? 1e6 + a;
      const kb = data.rows[b].loanIndex ?? 1e6 + b;
      return ka - kb;
    });

  // R6-5: the card's "owed after" comes from the same place as Home's loans
  // list once a payment on it is marked (lib/owed-now, UX50 B-12).
  const owedRows = ready ? owedNow(loans, entries, month) : null;
  const owedNowFor = (row: PayRow) => {
    const r = row.loanIndex !== null ? owedRows?.[row.loanIndex] : undefined;
    return r ? { owed: r.owed.toNumber(), ...(r.cardBefore ? { cardBefore: r.cardBefore.toNumber() } : {}) } : undefined;
  };
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
      {(data.extraUser > 0 || data.budget > 0) && (
        <p style={{ margin: '0 0 10px', fontSize: 12, lineHeight: 1.6 }}>
          {data.budget > 0
            ? `Your own total for debts: ${fmt(data.budget)} a month.`
            : `${fmt(data.extraUser)} of this is extra: all of your spare cash this month. Prefer to keep some?`}{' '}
          <LBracket href="/plan?set=budget">{data.budget > 0 ? 'CHANGE IT' : 'SET YOUR OWN TOTAL'} →</LBracket>
        </p>
      )}
      {alert && (
        <p style={{ margin: '0 0 12px', padding: '8px 12px', fontSize: 12, lineHeight: 1.6, ...lStrip('negative') }}>
          {alert}{' '}
          {/* UX50 B-14: what to say to the bank, one tap away. */}
          <LBracket href="/cant-pay">WHAT TO SAY TO THE BANK →</LBracket>
        </p>
      )}
      <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 12, color: L_T.positive, minHeight: said ? 18 : 0 }}>
        {said}
      </p>
      {error && <p role="alert" style={{ color: L_T.negative }}>{error}</p>}
      {ready && <EmailAnswers month={month} onMarkAllPaid={markAllPaid} />}

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: `2px solid ${L_T.ink}` }}>
        {order.map((i) => {
          const row = data.rows[i];
          const st = statuses[i];
          const no = row.loanIndex != null ? openNo.get(row.loanIndex) : undefined;
          const done = st?.tag === 'PAID';
          const foreign = row.currency !== userCcy;
          // UX50 B-01: the strip says where this month's extra goes, in
          // words, and stays (green) once it has been paid.
          const isExtra = row === firstExtra;
          const extraTag = isExtra ? (done ? 'EXTRA PAID' : 'EXTRA GOES HERE') : null;
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
                ...(isExtra ? lStrip(done ? 'positive' : 'accent') : null),
              }}
              data-extra={extraTag ? (done ? 'paid' : 'here') : undefined}
              aria-label={extraTag ? `${row.name}, ${extraTag.toLowerCase()}` : undefined}
            >
              <span style={{ color: L_T.muted, fontVariantNumeric: 'tabular-nums' }}>
                {no ? String(no).padStart(2, '0') : '··'}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {row.name}
                  {extraTag && (
                    <span
                      data-testid="extra-tag"
                      style={{ marginLeft: 8, fontSize: 11, letterSpacing: '0.1em', color: done ? L_T.positive : L_T.accent }}
                    >
                      · {extraTag}
                    </span>
                  )}
                  {st && (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 11,
                        letterSpacing: '0.1em',
                        color: st.tag === 'PAID' || st.tag === 'EMI PAID' ? L_T.positive : L_T.negative,
                      }}
                    >
                      · {st.tag === 'MISSED' ? 'NOT PAID' : st.tag === 'EMI PAID' && country === 'US' ? 'PAYMENT PAID' : st.tag}
                      {st.tag !== 'MISSED' && st.amount !== row.amount ? ` ${fmt(st.amount, row.currency)}` : ''} ·{' '}
                      {dayLabel(st.date)}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, letterSpacing: '0.04em', color: L_T.inkSoft, marginTop: 4, lineHeight: 1.5 }}>
                  {kindLine(row, fmt, owedNowFor(row), country)}
                  {row.dueDay ? ` · DUE ${row.dueDay} ${MONTH_NAMES_SHORT[Number(month.slice(5)) - 1].toUpperCase()}` : ''}
                </div>
                {reason && reason.key === row.key && !st && (
                  <div style={{ fontSize: 12, color: L_T.muted, marginTop: 4, lineHeight: 1.5 }}>{reason.text}</div>
                )}
              </div>
              <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                <div style={{ fontWeight: 700, fontSize: 18, textDecoration: done ? 'line-through' : 'none', color: done ? L_T.muted : L_T.ink }}>
                  {fmt(row.amount, row.currency)}
                </div>
                {foreign && <div style={{ fontSize: 11, color: L_T.muted }}>≈ {fmt(row.amountUser)}</div>}
              </div>
              <div style={{ gridColumn: '2 / -1', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {!ready ? null : st && st.tag !== 'EMI PAID' ? (
                  st.undoable ? (
                    <LBracket onClick={() => attempt(() => undo(row))} label={`Undo: ${row.name} not paid`}>
                      UNDO
                    </LBracket>
                  ) : (
                    <LBracket href="/activity#activity-ledger">LOGGED IN ACTIVITY →</LBracket>
                  )
                ) : open === row.key ? null : (
                  <>
                    <button
                      type="button"
                      onClick={() => attempt(() => markPaid(row))}
                      aria-label={
                        // R9-2 (WCAG 2.5.3): the spoken name starts with the words on the button.
                        row.loanIndex === null
                          ? `Set aside ${fmt(row.amount, row.currency)}: ${row.name}`
                          : st
                            ? `Mark extra paid: ${row.name}, ${fmt(row.amount - st.amount, row.currency)}`
                            : `Mark paid: ${row.name}, ${fmt(row.amount, row.currency)}`
                      }
                      style={lPayBtn(true)}
                    >
                      {row.loanIndex === null
                        ? `SET ASIDE ${fmt(row.amount, row.currency)}`
                        : st
                          ? `MARK EXTRA PAID · ${fmt(row.amount - st.amount, row.currency)}`
                          : 'MARK PAID'}
                    </button>
                    {row.loanIndex !== null && (
                      <button
                        type="button"
                        onClick={() => openOther(row)}
                        aria-label={`Other amount: paid a different amount on ${row.name}`}
                        style={lPayBtn(false)}
                      >
                        OTHER AMOUNT
                      </button>
                    )}
                    {row.loanIndex !== null &&
                      // E5 (audit 80): a rupee row for someone living abroad pays by
                      // UPI only from an NRE/NRO-linked UPI ID; show it once they've
                      // saved one, not as the default way to pay.
                      !(country === 'US' && row.currency === 'INR' && !(vpas[row.loanIndex] || loans[row.loanIndex]?.upi_vpa)) && (
                      <UpiPay
                        loan={loans[row.loanIndex] && (vpas[row.loanIndex] ? { ...loans[row.loanIndex], upi_vpa: vpas[row.loanIndex] } : loans[row.loanIndex])}
                        name={row.name}
                        amount={st ? row.amount - st.amount : row.amount}
                        currency={row.currency}
                        monthLabel={`${MONTH_NAMES_SHORT[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`}
                        onSaveVpa={(v) => saveVpa(row, v)}
                        rowKey={row.key}
                        month={month}
                        onConfirmed={() => attempt(() => markPaid(row))}
                      />
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
                      label={`${st?.tag === 'EMI PAID' ? 'Extra paid' : 'Paid this month'} (${row.currency === 'INR' ? '₹' : '$'})`}
                      kind="money"
                      currency={row.currency}
                      value={amount}
                      onChange={(v) => {
                        setAmount(v);
                        setError(null);
                      }}
                      placeholder={(st?.tag === 'EMI PAID' ? row.amount - st.amount : row.amount).toLocaleString(row.currency === 'INR' ? 'en-IN' : 'en-US')}
                      error={error}
                    />
                  </div>
                  <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', paddingBottom: 4 }}>
                    <button type="button" onClick={() => attempt(() => saveOther(row))} style={lPayBtn(true)}>
                      SAVE
                    </button>
                    {st?.tag !== 'EMI PAID' && (
                      <button type="button" onClick={() => attempt(() => saveOther(row, true))} style={lPayBtn(false)}>
                        I DIDN&apos;T PAY
                      </button>
                    )}
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
            alignItems: 'baseline',
            padding: '12px 10px 12px 46px',
            borderTop: `2px solid ${L_T.ink}`,
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          <span style={{ color: L_T.muted, letterSpacing: '0.1em', fontSize: 11, fontWeight: 400 }}>TOTAL THIS MONTH</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 18 }}>{fmt(data.total)}</span>
        </li>
      </ol>
      {data.leftOver > 0 && (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: L_T.muted, lineHeight: 1.6 }}>
          {data.budget > 0
            ? `${fmt(data.leftOver)} stays with you this month, outside your total for debts.`
            : `${fmt(data.leftOver)} is left over: no loan costs more than a safe return, so the plan keeps it. Save or invest it.`}
        </p>
      )}
      {cleared && cleared.loanIndex !== null && (
        <LoanCleared
          name={cleared.name}
          loanType={loans[cleared.loanIndex]?.loan_type ?? 'personal_loan'}
          lender={loans[cleared.loanIndex]?.bank ?? ''}
          country={country === 'US' ? 'US' : 'IN'}
          currency={cleared.currency}
          freed={cleared.minimum}
          nextName={data.rows.find((r) => r !== cleared && r.loanIndex !== null && r.kind !== 'clears')?.name}
          todayIso={today}
          onClose={() => setCleared(null)}
        />
      )}
      <div style={{ marginTop: 10 }}>
        <LBracket href="/plan">WHY THIS ORDER? SEE THE PLAN →</LBracket>
      </div>
      <PaydayEmail data={data} country={country === 'US' ? 'US' : 'IN'} todayIso={today} />
    </section>
  );
}

/** The section when there's nothing to tick: details missing, or no plan. */
export function PayNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <LSectionHeader>{title}</LSectionHeader>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: L_T.ink }}>{children}</p>
    </section>
  );
}

function kindLine(row: PayRow, fmt: (v: number, ccy?: PayRow['currency']) => string, now?: { owed: number; cardBefore?: number }, country?: string): string {
  // R8-2: a US borrower's word for the payment.
  const emiTag = country === 'US' ? 'PAYMENT' : 'EMI';
  const min = row.loanIndex !== null && row.minimum > 0 ? fmt(row.minimum, row.currency) : '';
  switch (row.kind) {
    case 'emi':
      return emiTag;
    case 'minimum':
      return 'CARD MINIMUM';
    case 'extra':
      return `${row.minimum > 0 ? `${min} ${row.card ? 'MINIMUM' : emiTag} + ` : ''}${fmt(row.extra, row.currency)} EXTRA${
        ((t) => (t ? ` · ${t}` : ''))(owedAfterLabel(row, now, (v) => fmt(v, row.currency)))
      }`;
    case 'clears':
      return row.payoff
        ? `PAYS IT OFF · ${payoffBreakdown(row.payoff.owed, row.payoff.interest, row.payoff.gst, (n) => fmt(n, row.currency)).toUpperCase()}`
        : 'PAYS IT OFF, INTEREST INCLUDED';
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
