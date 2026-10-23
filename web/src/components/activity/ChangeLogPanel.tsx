'use client';

/**
 * Every change, newest first, with a filter for the kind. Times are shown
 * in the person's own zone. A payment or a logged spend can be removed
 * from here; that removes the underlying record too.
 */
import { useEffect, useState } from 'react';
import { readChangeLog, removeChange, wholeMoney, type ChangeEntry, type ChangeKind } from '@/lib/change-log';
import { readActivityClient, removeActivityEntry } from '@/lib/activity';
import { commitActivity } from '@/lib/commit-activity';
import { readMonthlySpendClient, writeMonthlySpendClient } from '@/lib/monthly-spend';
import { loadProfileClient } from '@/lib/user-store';
import { LSectionHeader, L_T, LBracket } from '@/components/ledger/primitives';

const FILTERS: Array<{ id: ChangeKind | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'payment', label: 'Payments' },
  { id: 'prepayment', label: 'Prepayments' },
  { id: 'spend', label: 'Spending' },
  { id: 'loan', label: 'Loans' },
  { id: 'goal', label: 'Goals' },
  { id: 'tax', label: 'Tax' },
  { id: 'letter', label: 'Letters' },
  { id: 'import', label: 'Imports' },
  { id: 'asset', label: 'Assets' },
  { id: 'income', label: 'Income' },
  { id: 'settings', label: 'Settings' },
];

/** A new payment row: "before" is the EMI that was due, "after" what was paid. */
const fresh = (r: ChangeEntry) => (r.kind === 'payment' || r.kind === 'prepayment') && r.what.endsWith(' recorded');

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

/** Money rows store plain numbers ("6000", "part payment 1000"); show the
 *  trailing amount in the household's currency. Loan rows arrive formatted. */
const MONEY_KINDS: ChangeKind[] = ['payment', 'prepayment', 'spend'];
function money(v: string, kind: ChangeKind, currency: 'INR' | 'USD'): string {
  if (!MONEY_KINDS.includes(kind)) return v;
  return v.replace(/(^|\s)(-?\d+(?:\.\d+)?)$/, (_, sp: string, n: string) => sp + wholeMoney(Number(n), currency));
}

export function ChangeLogPanel() {
  const [rows, setRows] = useState<ChangeEntry[]>([]);
  const [filter, setFilter] = useState<ChangeKind | 'all'>('all');
  const [currency, setCurrency] = useState<'INR' | 'USD'>('INR');

  useEffect(() => {
    setCurrency(loadProfileClient().user?.country === 'US' ? 'USD' : 'INR');
    const read = () => setRows(readChangeLog());
    read();
    window.addEventListener('storage', read);
    return () => window.removeEventListener('storage', read);
  }, []);

  const shown = filter === 'all' ? rows : rows.filter((r) => r.kind === filter);

  function undo(row: ChangeEntry) {
    if (row.refId && (row.kind === 'payment' || row.kind === 'prepayment')) {
      const user = loadProfileClient().user;
      commitActivity(removeActivityEntry(readActivityClient(), row.refId), user);
    }
    if (row.refId && row.kind === 'spend') {
      writeMonthlySpendClient(readMonthlySpendClient().filter((e) => e.id !== row.refId));
    }
    setRows(removeChange(row.id));
  }

  return (
    <section aria-labelledby="change-log-h" data-testid="change-log">
      <LSectionHeader>
        <span id="change-log-h">Changes</span>
      </LSectionHeader>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: L_T.muted, lineHeight: 1.5 }}>
        Every change on this device, newest first. Times follow your clock.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            data-testid={`change-filter-${f.id}`}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '4px 8px',
              border: `1px solid ${L_T.ink}`,
              background: filter === f.id ? L_T.ink : 'transparent',
              color: filter === f.id ? L_T.bg : L_T.ink,
              cursor: 'pointer',
            }}
          >
            {f.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p data-testid="change-log-empty" style={{ margin: 0, fontSize: 12, color: L_T.muted }}>Nothing in this filter.</p>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {shown.map((r) => (
            <li key={r.id} data-testid="change-row" style={{ padding: '8px 0', borderBottom: `1px dashed ${L_T.ruleSoft}`, fontSize: 12, lineHeight: 1.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>{r.what}</strong>
                <time dateTime={r.at} style={{ color: L_T.muted, whiteSpace: 'nowrap' }}>{when(r.at)}</time>
              </div>
              {(r.before || r.after) && (
                <div style={{ color: L_T.inkSoft }}>
                  {r.before ? <span>{fresh(r) ? 'Due' : 'Before'}: {money(r.before, r.kind, currency)}</span> : null}
                  {r.before && r.after ? ' · ' : null}
                  {r.after ? <span>{fresh(r) ? 'Paid' : 'After'}: {money(r.after, r.kind, currency)}</span> : null}
                </div>
              )}
              {r.refId && (r.kind === 'payment' || r.kind === 'prepayment' || r.kind === 'spend') && (
                <LBracket onClick={() => undo(r)} label={`Undo ${r.what}`}>UNDO</LBracket>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
