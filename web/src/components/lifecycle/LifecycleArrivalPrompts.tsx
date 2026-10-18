'use client';

/**
 * Arrival prompts on /plan — shown when a planned lifecycle event's
 * effectiveDate is today-or-past and its status is still 'planned'.
 * Each prompt asks "did this happen?" with Confirm / Cancel inline
 * actions, plus a "Postpone…" affordance that bumps the date forward
 * by 30 days.
 *
 * Reads the same cookie as `LifecycleEventsPanel`. Listens to focus
 * events so a confirmation flow on /debts is reflected on next /plan
 * visit without a hard refresh.
 *
 * Renders nothing when there's nothing to prompt about — no empty banner.
 */

import { resolveLoanIndex } from '@/lib/loan-ids';
import { useEffect, useState } from 'react';
import type { UserPayload } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import {
  readLifecycleClient,
  writeLifecycleClient,
  updateLifecycleEvent,
  pendingArrivals,
  LIFECYCLE_KIND_LABEL,
  type LifecycleEvent,
} from '@/lib/lifecycle-events';
import { commitLifecycle } from '@/lib/commit-lifecycle';
import { localIsoDate } from '@/lib/today';
import { LOAN_TYPE_NAME, loanLabel } from '@/lib/loan-types';

type Variant = 'ledger' | 'existing' | 'editorial';

export function LifecycleArrivalPrompts({
  user,
  variant,
}: {
  user: UserPayload;
  variant: Variant;
}) {
  const [ready, setReady] = useState(false);
  const [error,setError] = useState('');
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  // Per-event postpone log: id → most-recent new effectiveDate. Drives
  // the inline "Postponed to YYYY-MM-DD" confirmation under each row so
  // a user clicking Postpone twice in a row can see what happened.
  // Cleared when the user confirms or cancels (the row disappears
  // anyway), or after a manual dismiss.
  const [postponedTo, setPostponedTo] = useState<Record<string, string>>({});

  useEffect(() => {
    setEvents(readLifecycleClient());
    setReady(true);
    function onFocus() {
      setEvents(readLifecycleClient());
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const pending = ready ? pendingArrivals(events) : [];
  if (pending.length === 0 && !error) return null;

  function setStatus(id: string, status: 'confirmed' | 'cancelled') {
    try {setEvents(commitLifecycle(id,status));setError('');}
    catch(e) {setError((e as Error).message);}
  }

  function postpone(id: string, currentIso: string) {
    const d = new Date(Math.max(new Date(currentIso+'T00:00:00').getTime(), Date.now()));
    d.setDate(d.getDate() + 30);
    const newIso = localIsoDate(d);
    const next = updateLifecycleEvent(readLifecycleClient(), id, { effectiveDate: newIso });
    try {
      writeLifecycleClient(next);
      setEvents(next);
      setPostponedTo((prev) => ({ ...prev, [id]: newIso }));
      setError('');
    } catch(e) {setError((e as Error).message);}

  }

  return (
    <section style={containerStyle(variant)}>
      {error && <p role="alert" style={{color:'var(--negative)'}}>{error}</p>}
      <div style={labelStyle(variant)}>
        {pending.length === 1
          ? 'Arrival prompt · did this happen?'
          : `${pending.length} arrival prompts · did these happen?`}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
        {pending.map((e) => (
          <Prompt
            key={e.id}
            event={e}
            user={user}
            variant={variant}
            postponedTo={postponedTo[e.id] ?? null}
            onConfirm={() => setStatus(e.id, 'confirmed')}
            onCancel={() => setStatus(e.id, 'cancelled')}
            onPostpone={() => postpone(e.id, e.effectiveDate)}
          />
        ))}
      </div>
      <div style={hintStyle(variant)}>
        Confirming logs the event as actually-happened. Postponing pushes the
        target out by 30 days. Every planned event is listed{' '}
        <a href="/plan#life-events" style={{ color: 'var(--accent)' }}>
          further down this page
        </a>
        .
      </div>
    </section>
  );
}

function Prompt({
  event: e,
  user,
  variant,
  postponedTo,
  onConfirm,
  onCancel,
  onPostpone,
}: {
  event: LifecycleEvent;
  user: UserPayload;
  variant: Variant;
  /** When non-null, the user just postponed this row to this date —
   *  render an inline confirmation so a follow-up tap doesn't look
   *  silent. */
  postponedTo: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onPostpone: () => void;
}) {
  const ccy = user.country === 'IN' ? 'INR' : 'USD';
  const kindLabel = LIFECYCLE_KIND_LABEL[e.kind];
  let summary = '';
  if (e.kind === 'salary_reset') {
    summary = `New gross ${formatCurrency(e.newAnnualGross, ccy)}/yr from ${e.effectiveDate}`;
  } else if (e.kind === 'floating_rate_reset') {
    const loan = user.loans[resolveLoanIndex(e, user.loans)];
    const lender = loan ? loanLabel(loan) : 'A loan since removed';
    summary = `${lender} rate → ${(Number(e.newRate) * 100).toFixed(2)}% from ${e.effectiveDate}`;
  } else if (e.kind === 'property_buy') {
    const d = e.loanDraft;
    summary = `${d.bank ? loanLabel(d) : `New ${LOAN_TYPE_NAME[d.loan_type]}`} of ${formatCurrency(d.outstanding, ccy)} closing on ${e.effectiveDate}`;
  }

  return (
    <div style={promptRowStyle(variant)}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>{kindLabel}</div>
        <div style={{ fontSize: 13 }}>{summary}</div>
        {e.note && (
          <div className="muted" style={{ fontSize: 12, marginTop: 2, fontStyle: 'italic' }}>
            {e.note}
          </div>
        )}
        {postponedTo && (
          <div
            style={{
              fontSize: 11,
              marginTop: 4,
              color: 'var(--accent)',
              fontStyle: variant === 'editorial' ? 'italic' : 'normal',
            }}
          >
            Postponed to {postponedTo}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button type="button" onClick={onConfirm} style={btn(variant, 'primary')}>
          Yes, it happened
        </button>
        <button type="button" onClick={onPostpone} style={btn(variant, 'secondary')}>
          Postpone +30d
        </button>
        <button type="button" onClick={onCancel} style={btn(variant, 'secondary')}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── styles ─────────────────────────────────────────────────────────────────

function containerStyle(variant: Variant): React.CSSProperties {
  if (variant === 'ledger') {
    return {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      lineHeight: 1.55,
      borderLeft: '3px solid var(--accent)',
      paddingLeft: 12,
    };
  }
  if (variant === 'editorial') {
    return {
      margin: '24px 0',
      paddingLeft: 14,
      borderLeft: '3px solid var(--accent)',
    };
  }
  return {
    padding: 14,
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderLeft: '3px solid var(--accent)',
    borderRadius: 6,
  };
}

function labelStyle(variant: Variant): React.CSSProperties {
  if (variant === 'ledger') {
    return {
      fontSize: 11,
      color: 'var(--accent)',
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
    };
  }
  if (variant === 'editorial') {
    return {
      fontFamily: 'var(--font-sans)',
      fontSize: 11,
      letterSpacing: '0.15em',
      textTransform: 'uppercase',
      color: 'var(--accent)',
    };
  }
  return { fontSize: 14, fontWeight: 600, color: 'var(--accent)' };
}

function hintStyle(variant: Variant): React.CSSProperties {
  return {
    marginTop: 10,
    fontSize: 11,
    color: 'var(--muted)',
    fontFamily: variant === 'ledger' ? 'var(--font-mono)' : 'inherit',
    fontStyle: variant === 'editorial' ? 'italic' : 'normal',
  };
}

function promptRowStyle(variant: Variant): React.CSSProperties {
  return {
    display: 'flex',
    gap: 12,
    alignItems: 'flex-start',
    padding: variant === 'ledger' ? '8px 0' : 8,
    background: variant === 'ledger' ? 'transparent' : 'var(--canvas)',
    border:
      variant === 'ledger'
        ? '1px dashed var(--border)'
        : '1px solid var(--border)',
    borderRadius: variant === 'ledger' ? 0 : 4,
    paddingLeft: variant === 'ledger' ? 8 : 10,
    paddingRight: variant === 'ledger' ? 8 : 10,
  };
}

function btn(
  variant: Variant,
  kind: 'primary' | 'secondary',
): React.CSSProperties {
  if (variant === 'ledger') {
    return {
      padding: '4px 10px',
      border: '1px solid var(--ink)',
      background: kind === 'primary' ? 'var(--ink)' : 'var(--canvas)',
      color: kind === 'primary' ? 'var(--canvas)' : 'var(--ink)',
      fontSize: 10,
      letterSpacing: '0.1em',
      cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
      whiteSpace: 'nowrap',
    };
  }
  return {
    padding: '5px 10px',
    background: kind === 'primary' ? 'var(--accent)' : 'transparent',
    color: kind === 'primary' ? 'var(--card)' : 'var(--muted)',
    border: kind === 'primary' ? 'none' : '1px solid var(--border)',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}
