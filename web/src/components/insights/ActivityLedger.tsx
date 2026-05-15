'use client';

/**
 * User-recorded activity ledger — the engine that drives all three theme
 * variants of the Insights page.
 *
 * Replaces the hardcoded LOG + CALENDAR arrays that the page used to ship
 * with. Reads/writes entries from localStorage via `lib/activity`, shows
 * a penalty estimate next to each partial/missed entry via
 * `lib/estimate-penalty`. Per Hasen's Bucket-C scope, NO calendar OAuth —
 * the ledger is fully manual.
 *
 * The component is theme-aware: it ships three layouts under one logic
 * shell, picked by `variant`. The form is shared (cards-style with subtle
 * variant tweaks); only the entries list differs significantly between
 * themes.
 */

import { useEffect, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import {
  addActivityEntry,
  daysLate,
  overdueAmount,
  readActivityClient,
  removeActivityEntry,
  sortActivityNewestFirst,
  writeActivityClient,
  type ActivityEntry,
  type ActivityKind,
} from '@/lib/activity';
import { estimateLateFee } from '@/lib/estimate-penalty';
import { syncActivityCookieClient } from '@/lib/activity-cookie';
import {
  formatINR,
  formatUSD,
  type Country,
  type LoanPayload,
  type UserPayload,
} from '@/lib/api';

export type LedgerVariant = 'ledger' | 'existing' | 'editorial';

const KIND_LABEL: Record<ActivityKind, string> = {
  paid_full: 'Paid in full',
  paid_partial: 'Paid partial',
  missed: 'Missed entirely',
};

const KIND_TONE: Record<ActivityKind, string> = {
  paid_full: 'var(--positive)',
  paid_partial: 'var(--accent)',
  missed: 'var(--negative)',
};

const LOAN_TYPE_SHORT: Record<string, string> = {
  home_loan: 'home',
  auto_loan: 'auto',
  personal_loan: 'personal',
  credit_card: 'card',
  education_loan: 'education',
  gold_loan: 'gold',
  bnpl: 'BNPL',
};

function today(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function moneyFmt(country: Country) {
  return country === 'IN' ? formatINR : formatUSD;
}

export function ActivityLedger({
  user,
  variant,
}: {
  user: UserPayload;
  variant: LedgerVariant;
}) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const fmt = moneyFmt(user.country);

  // Hydrate from localStorage AFTER mount so SSR doesn't see different
  // markup than the first client render. The skeleton state below shows
  // a "loading" line briefly; in practice it's one tick.
  useEffect(() => {
    const initial = readActivityClient();
    setEntries(initial);
    setHydrated(true);
    // Also re-sync the cookie at mount so the cookie reflects whatever
    // localStorage carries — covers the "new browser, restored from
    // backup" case where localStorage exists but the cookie doesn't.
    syncActivityCookieClient(initial, user.loans, user.country);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync across tabs — if another tab adds an entry, refresh ours.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === 'finoptima_activity') {
        const next = readActivityClient();
        setEntries(next);
        syncActivityCookieClient(next, user.loans, user.country);
      }
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [user.loans, user.country]);

  function commit(next: ActivityEntry[]) {
    setEntries(next);
    writeActivityClient(next);
    // Mirror the projection-relevant subset to a cookie so /plan can apply
    // the deltas server-side on next render.
    syncActivityCookieClient(next, user.loans, user.country);
  }

  function add(draft: Omit<ActivityEntry, 'id' | 'loggedAt'>) {
    commit(addActivityEntry(entries, draft));
  }

  function remove(id: string) {
    commit(removeActivityEntry(entries, id));
  }

  const sorted = useMemo(() => sortActivityNewestFirst(entries), [entries]);
  const validEntries = useMemo(
    () => sorted.filter((e) => e.loanIndex >= 0 && e.loanIndex < user.loans.length),
    [sorted, user.loans.length],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: variant === 'ledger' ? 18 : 22 }}>
      <LogForm onAdd={add} loans={user.loans} country={user.country} variant={variant} />
      <EntriesList
        entries={validEntries}
        loans={user.loans}
        country={user.country}
        fmt={fmt}
        onRemove={remove}
        hydrated={hydrated}
        variant={variant}
      />
    </div>
  );
}

// ─── Log form ───────────────────────────────────────────────────────────────

function LogForm({
  onAdd,
  loans,
  country,
  variant,
}: {
  onAdd: (draft: Omit<ActivityEntry, 'id' | 'loggedAt'>) => void;
  loans: LoanPayload[];
  country: Country;
  variant: LedgerVariant;
}) {
  const [loanIndex, setLoanIndex] = useState(0);
  const [kind, setKind] = useState<ActivityKind>('paid_full');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const selectedLoan: LoanPayload | undefined = loans[loanIndex];
  const scheduledEmi = selectedLoan?.scheduled_emi ?? '0';

  // Default the amount when kind / loan changes.
  useEffect(() => {
    if (kind === 'paid_full') setAmount(scheduledEmi);
    else if (kind === 'missed') setAmount('0');
    else setAmount(''); // partial — user types
  }, [kind, scheduledEmi]);

  if (loans.length === 0) {
    return (
      <Panel variant={variant}>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
          Add a loan in setup to start logging payment activity. Once you
          have at least one loan, this panel becomes a form for recording
          paid / partial / missed events.
        </div>
      </Panel>
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLoan) return;
    onAdd({
      loanIndex,
      kind,
      date,
      amount: amount.trim() === '' ? '0' : amount,
      scheduledEmi,
      note: note.trim() || undefined,
    });
    setNote('');
    setKind('paid_full');
    setAmount(scheduledEmi);
  }

  const inputStyle: React.CSSProperties = {
    padding: '6px 10px',
    fontSize: 13,
    border: '1px solid var(--border)',
    borderRadius: variant === 'ledger' ? 0 : 6,
    background: 'var(--canvas)',
    color: 'var(--ink)',
    fontFamily: variant === 'ledger' ? 'var(--font-mono)' : 'var(--font-sans)',
    width: '100%',
  };

  return (
    <Panel variant={variant}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
        Log a payment event
      </div>
      <form
        onSubmit={submit}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 10,
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="muted" style={{ fontSize: 11 }}>
            Which loan
          </span>
          <select
            value={loanIndex}
            onChange={(e) => setLoanIndex(Number(e.target.value))}
            style={inputStyle}
          >
            {loans.map((l, i) => (
              <option key={i} value={i}>
                {l.bank || 'Unnamed'} · {LOAN_TYPE_SHORT[l.loan_type] ?? l.loan_type}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="muted" style={{ fontSize: 11 }}>
            What happened
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as ActivityKind)}
            style={inputStyle}
          >
            <option value="paid_full">Paid in full</option>
            <option value="paid_partial">Paid partial</option>
            <option value="missed">Missed entirely</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="muted" style={{ fontSize: 11 }}>
            Payment date
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            max={today()}
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="muted" style={{ fontSize: 11 }}>
            Amount paid {country === 'IN' ? '(₹)' : '($)'}
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={kind === 'missed'}
            placeholder={
              kind === 'paid_partial' ? `Less than ${scheduledEmi}` : scheduledEmi
            }
            style={{
              ...inputStyle,
              fontFamily: 'var(--font-mono)',
              textAlign: 'right',
              opacity: kind === 'missed' ? 0.5 : 1,
            }}
          />
        </label>
        <label style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="muted" style={{ fontSize: 11 }}>
            Note (optional)
          </span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. paid 5 days late, called bank to waive fee"
            style={inputStyle}
            maxLength={120}
          />
        </label>
        <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="submit"
            className="btn btn-primary"
            style={{
              padding: '6px 14px',
              fontSize: 13,
              cursor: 'pointer',
              borderRadius: variant === 'ledger' ? 0 : 6,
            }}
          >
            {variant === 'ledger' ? '[LOG ENTRY]' : 'Log entry'}
          </button>
        </div>
      </form>
      <div
        className="muted"
        style={{ fontSize: 11, marginTop: 10, lineHeight: 1.55 }}
      >
        Stored locally to this browser only — same model as the rest of your
        profile. Penalty estimates use your bank&apos;s published Schedule of
        Charges when available, otherwise a country/loan-type default.
      </div>
    </Panel>
  );
}

// ─── Entries list ──────────────────────────────────────────────────────────

function EntriesList({
  entries,
  loans,
  country,
  fmt,
  onRemove,
  hydrated,
  variant,
}: {
  entries: ActivityEntry[];
  loans: LoanPayload[];
  country: Country;
  fmt: (v: string | number) => string;
  onRemove: (id: string) => void;
  hydrated: boolean;
  variant: LedgerVariant;
}) {
  if (!hydrated) {
    return (
      <Panel variant={variant}>
        <div className="muted" style={{ fontSize: 12 }}>
          Loading activity…
        </div>
      </Panel>
    );
  }

  if (entries.length === 0) {
    return (
      <Panel variant={variant}>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
          {variant === 'editorial'
            ? 'Nothing in the ledger yet. As you log payments above, the entries will appear here with a penalty estimate beside any partial or missed payments — so you can see, in numbers, what skipping an EMI would have cost.'
            : "No entries yet. Log a payment above — partial and missed entries show the penalty you'd have been charged."}
        </div>
      </Panel>
    );
  }

  if (variant === 'ledger') {
    return (
      <LedgerEntries
        entries={entries}
        loans={loans}
        country={country}
        fmt={fmt}
        onRemove={onRemove}
      />
    );
  }

  if (variant === 'editorial') {
    return (
      <EditorialEntries
        entries={entries}
        loans={loans}
        country={country}
        fmt={fmt}
        onRemove={onRemove}
      />
    );
  }

  return (
    <ExistingEntries
      entries={entries}
      loans={loans}
      country={country}
      fmt={fmt}
      onRemove={onRemove}
    />
  );
}

// ─── Ledger entries (mono table) ────────────────────────────────────────────

function LedgerEntries({
  entries,
  loans,
  country,
  fmt,
  onRemove,
}: {
  entries: ActivityEntry[];
  loans: LoanPayload[];
  country: Country;
  fmt: (v: string | number) => string;
  onRemove: (id: string) => void;
}) {
  return (
    <section>
      <div
        style={{
          fontSize: 11,
          color: 'var(--muted)',
          letterSpacing: '0.18em',
          marginBottom: 6,
          fontFamily: 'var(--font-mono)',
        }}
      >
        $ ACTIVITY · {entries.length} ENTRIES
      </div>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
        }}
      >
        <thead>
          <tr
            style={{
              borderTop: '2px solid var(--ink)',
              borderBottom: '1px solid var(--ink)',
            }}
          >
            {['DATE', 'LOAN', 'EVENT', 'PAID', 'PENALTY EST.', ''].map((h, i) => (
              <th
                key={h + i}
                style={{
                  padding: '8px 12px',
                  textAlign: i >= 3 && i < 5 ? 'right' : 'left',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  fontSize: 10,
                  color: 'var(--muted)',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const loan = loans[e.loanIndex];
            const overdue = overdueAmount(e);
            const isClean = e.kind === 'paid_full';
            const est = isClean
              ? null
              : estimateLateFee({
                  loanType: loan.loan_type,
                  country,
                  bank: loan.bank,
                  overdueAmount: overdue,
                  daysLate: daysLate(e),
                });
            return (
              <tr
                key={e.id}
                style={{
                  borderBottom: '1px dashed var(--dash)',
                }}
              >
                <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                  {e.date}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  {loan.bank || 'Unnamed'}{' '}
                  <span style={{ color: 'var(--muted)' }}>
                    · {LOAN_TYPE_SHORT[loan.loan_type] ?? loan.loan_type}
                  </span>
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    fontWeight: 700,
                    color: KIND_TONE[e.kind],
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {e.kind.replace('_', ' ')}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  {fmt(e.amount)}
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    textAlign: 'right',
                    color: est && est.total.gt(0) ? 'var(--negative)' : 'var(--muted)',
                    fontWeight: est && est.total.gt(0) ? 600 : 400,
                  }}
                >
                  {est && est.total.gt(0)
                    ? `~${fmt(est.total.toFixed(0))}`
                    : '—'}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                  <button
                    type="button"
                    onClick={() => onRemove(e.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--muted)',
                      fontSize: 11,
                      letterSpacing: '0.12em',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)',
                    }}
                    aria-label="Delete entry"
                    title="Delete entry"
                  >
                    [×]
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <NoteSummary entries={entries} variant="ledger" />
    </section>
  );
}

// ─── Existing entries (card list) ───────────────────────────────────────────

function ExistingEntries({
  entries,
  loans,
  country,
  fmt,
  onRemove,
}: {
  entries: ActivityEntry[];
  loans: LoanPayload[];
  country: Country;
  fmt: (v: string | number) => string;
  onRemove: (id: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="muted" style={{ fontSize: 12 }}>
        {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · newest first
      </div>
      {entries.map((e) => {
        const loan = loans[e.loanIndex];
        const overdue = overdueAmount(e);
        const est =
          e.kind === 'paid_full'
            ? null
            : estimateLateFee({
                loanType: loan.loan_type,
                country,
                bank: loan.bank,
                overdueAmount: overdue,
                daysLate: daysLate(e),
              });
        return (
          <div
            key={e.id}
            style={{
              border: '1px solid var(--border)',
              borderLeft: `3px solid ${KIND_TONE[e.kind]}`,
              borderRadius: 6,
              padding: 12,
              background: 'var(--card)',
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 8,
            }}
          >
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 10,
                  flexWrap: 'wrap',
                  marginBottom: 4,
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 14 }}>
                  {loan.bank || 'Unnamed'}{' '}
                  <span className="muted" style={{ fontWeight: 400 }}>
                    · {LOAN_TYPE_SHORT[loan.loan_type] ?? loan.loan_type}
                  </span>
                </span>
                <span
                  className="chip"
                  style={{
                    background: 'transparent',
                    color: KIND_TONE[e.kind],
                    borderColor: KIND_TONE[e.kind],
                    fontSize: 11,
                  }}
                >
                  {KIND_LABEL[e.kind]}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {e.date}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                Paid <span className="num">{fmt(e.amount)}</span> of{' '}
                <span className="num">{fmt(e.scheduledEmi)}</span> scheduled
                {est && est.total.gt(0) && (
                  <>
                    {' '}· Likely penalty{' '}
                    <span
                      className="num"
                      style={{ color: 'var(--negative)', fontWeight: 600 }}
                    >
                      ~{fmt(est.total.toFixed(0))}
                    </span>{' '}
                    <PenaltyBreakdownTooltip est={est} fmt={fmt} />
                  </>
                )}
                {e.note && (
                  <div
                    style={{ fontSize: 12, marginTop: 4, fontStyle: 'italic' }}
                  >
                    “{e.note}”
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onRemove(e.id)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--muted)',
                cursor: 'pointer',
                fontSize: 18,
                lineHeight: 1,
                padding: '0 4px',
                alignSelf: 'start',
              }}
              aria-label="Delete entry"
              title="Delete entry"
            >
              ×
            </button>
          </div>
        );
      })}
      <NoteSummary entries={entries} variant="existing" />
    </div>
  );
}

// ─── Editorial entries (dispatches) ─────────────────────────────────────────

function EditorialEntries({
  entries,
  loans,
  country,
  fmt,
  onRemove,
}: {
  entries: ActivityEntry[];
  loans: LoanPayload[];
  country: Country;
  fmt: (v: string | number) => string;
  onRemove: (id: string) => void;
}) {
  return (
    <div>
      <div
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 10,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: 'var(--soft)',
          marginBottom: 16,
        }}
      >
        Dispatches, in your hand · {entries.length}{' '}
        {entries.length === 1 ? 'entry' : 'entries'}
      </div>
      {entries.map((e, i) => {
        const loan = loans[e.loanIndex];
        const overdue = overdueAmount(e);
        const est =
          e.kind === 'paid_full'
            ? null
            : estimateLateFee({
                loanType: loan.loan_type,
                country,
                bank: loan.bank,
                overdueAmount: overdue,
                daysLate: daysLate(e),
              });
        return (
          <div
            key={e.id}
            style={{
              paddingBottom: 24,
              marginBottom: 24,
              borderBottom:
                i === entries.length - 1 ? 'none' : '1px solid var(--border)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 18,
                marginBottom: 8,
                fontFamily: 'var(--font-sans)',
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.12em',
                color: 'var(--soft)',
              }}
            >
              <span>
                {KIND_LABEL[e.kind]} · {loan.bank || 'Unnamed'}
              </span>
              <span>{e.date}</span>
            </div>
            <p
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 17,
                lineHeight: 1.65,
                margin: 0,
              }}
            >
              You sent <strong>{fmt(e.amount)}</strong> against your{' '}
              {LOAN_TYPE_SHORT[loan.loan_type] ?? loan.loan_type} with{' '}
              {loan.bank || 'this lender'} on {e.date}. The scheduled EMI was{' '}
              <strong>{fmt(e.scheduledEmi)}</strong>.
              {est && est.total.gt(0) && (
                <>
                  {' '}On the bank&apos;s published Schedule of Charges this
                  would attract{' '}
                  <strong style={{ color: 'var(--negative)' }}>
                    roughly {fmt(est.total.toFixed(0))}
                  </strong>{' '}
                  in late fees and penal interest
                  {country === 'IN' && est.gst.gt(0) && ' (including GST)'}.
                </>
              )}
              {e.note && (
                <>
                  {' '}
                  <em style={{ color: 'var(--muted)' }}>“{e.note}”</em>
                </>
              )}
            </p>
            <button
              type="button"
              onClick={() => onRemove(e.id)}
              style={{
                marginTop: 8,
                background: 'transparent',
                border: 'none',
                color: 'var(--muted)',
                cursor: 'pointer',
                fontFamily: 'var(--font-sans)',
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                padding: 0,
              }}
            >
              remove ×
            </button>
          </div>
        );
      })}
      <NoteSummary entries={entries} variant="editorial" />
    </div>
  );
}

// ─── Footer summary across all variants ─────────────────────────────────────

function NoteSummary({
  entries,
  variant,
}: {
  entries: ActivityEntry[];
  variant: LedgerVariant;
}) {
  const totalPenalties = useMemo(() => {
    let sum = new Decimal(0);
    for (const e of entries) {
      if (e.kind === 'paid_full') continue;
      // We can't recompute the penalty here cheaply without re-pulling the
      // loan + country; instead, show entry count and let the per-row
      // estimates speak for themselves.
      sum = sum.add(1);
    }
    return Number(sum);
  }, [entries]);

  if (totalPenalties === 0) return null;

  const text =
    totalPenalties === 1
      ? `1 entry has a penalty estimate above. Penalties accrue per cycle; the longer the delay, the more they grow.`
      : `${totalPenalties} entries have a penalty estimate above. The longer each goes unpaid, the more interest stacks on top.`;

  if (variant === 'ledger') {
    return (
      <div
        style={{
          marginTop: 14,
          padding: '8px 12px',
          border: '1px dashed var(--border)',
          fontSize: 11,
          color: 'var(--muted)',
          letterSpacing: '0.04em',
          fontFamily: 'var(--font-mono)',
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: 'var(--ink)' }}>NOTE</strong> · {text} A future
        update will feed missed events back into /plan so the projection
        reflects the actual past, not the optimistic baseline.
      </div>
    );
  }

  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        background: 'var(--soft-bg)',
        borderRadius: variant === 'editorial' ? 0 : 6,
        fontSize: 12,
        color: 'var(--muted)',
        lineHeight: 1.55,
      }}
    >
      {text} A future update will feed missed events back into your plan so the
      projection reflects the actual past, not the optimistic baseline.
    </div>
  );
}

// ─── Small helpers ─────────────────────────────────────────────────────────

function Panel({
  children,
  variant,
}: {
  children: React.ReactNode;
  variant: LedgerVariant;
}) {
  if (variant === 'ledger') {
    return (
      <section
        style={{
          border: '1px solid var(--ink)',
          padding: 16,
          background: 'var(--card)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
        }}
      >
        {children}
      </section>
    );
  }
  return (
    <section
      style={{
        border: '1px solid var(--border)',
        borderRadius: variant === 'editorial' ? 0 : 8,
        padding: 14,
        background: 'var(--card)',
      }}
    >
      {children}
    </section>
  );
}

function PenaltyBreakdownTooltip({
  est,
  fmt,
}: {
  est: ReturnType<typeof estimateLateFee>;
  fmt: (v: string | number) => string;
}) {
  const parts: string[] = [
    `Late fee ${fmt(est.flatFee.toFixed(0))}`,
    `Penal interest ${fmt(est.penalInterest.toFixed(0))}`,
  ];
  if (est.gst.gt(0)) parts.push(`GST ${fmt(est.gst.toFixed(0))}`);
  parts.push(
    est.source === 'bank_specific'
      ? `from this bank's Schedule of Charges`
      : `from country/loan-type defaults`,
  );
  return (
    <abbr
      title={parts.join(' · ')}
      style={{
        cursor: 'help',
        borderBottom: '1px dotted var(--muted)',
        marginLeft: 4,
        fontSize: 11,
      }}
    >
      breakdown
    </abbr>
  );
}
