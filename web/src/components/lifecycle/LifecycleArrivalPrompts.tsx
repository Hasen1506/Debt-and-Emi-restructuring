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

import { useEffect, useState } from 'react';
import type { UserPayload } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import {
  readLifecycleClient,
  writeLifecycleClient,
  updateLifecycleEvent,
  applyConfirmedEvent,
  pendingArrivals,
  LIFECYCLE_KIND_LABEL,
  type LifecycleEvent,
} from '@/lib/lifecycle-events';
import { saveProfileClient } from '@/lib/user-store';

type Variant = 'ledger' | 'existing' | 'editorial';

export function LifecycleArrivalPrompts({
  user,
  variant,
}: {
  user: UserPayload;
  variant: Variant;
}) {
  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState<LifecycleEvent[]>([]);

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
  if (pending.length === 0) return null;

  function setStatus(id: string, status: 'confirmed' | 'cancelled') {
    const target = events.find((e) => e.id === id);
    const next = updateLifecycleEvent(events, id, { status });
    writeLifecycleClient(next);
    setEvents(next);
    // On confirm: bake the event into the profile so the engine simulates
    // against the new salary/rate/loan. saveProfileClient dual-writes to
    // server, so this carries across devices too.
    if (status === 'confirmed' && target && target.status !== 'confirmed') {
      const updatedUser = applyConfirmedEvent(user, target);
      saveProfileClient({ user: updatedUser });
    }
  }

  function postpone(id: string, currentIso: string) {
    const d = new Date(currentIso);
    d.setDate(d.getDate() + 30);
    const next = updateLifecycleEvent(events, id, {
      effectiveDate: d.toISOString().slice(0, 10),
    });
    writeLifecycleClient(next);
    setEvents(next);
  }

  return (
    <section style={containerStyle(variant)}>
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
            onConfirm={() => setStatus(e.id, 'confirmed')}
            onCancel={() => setStatus(e.id, 'cancelled')}
            onPostpone={() => postpone(e.id, e.effectiveDate)}
          />
        ))}
      </div>
      <div style={hintStyle(variant)}>
        Confirming logs the event as actually-happened. Postponing pushes the
        target out by 30 days. You can manage all events on{' '}
        <a href="/debts" style={{ color: 'var(--accent)' }}>
          /debts
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
  onConfirm,
  onCancel,
  onPostpone,
}: {
  event: LifecycleEvent;
  user: UserPayload;
  variant: Variant;
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
    const loan = user.loans[e.loanIndex];
    const lender = loan ? loan.bank || loan.loan_type : `Loan #${e.loanIndex + 1}`;
    summary = `${lender} rate → ${(Number(e.newRate) * 100).toFixed(2)}% from ${e.effectiveDate}`;
  } else if (e.kind === 'property_buy') {
    const d = e.loanDraft;
    summary = `${d.bank || 'New loan'} ${d.loan_type.replace('_', ' ')} of ${formatCurrency(d.outstanding, ccy)} closing on ${e.effectiveDate}`;
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
    color: kind === 'primary' ? '#fff' : 'var(--muted)',
    border: kind === 'primary' ? 'none' : '1px solid var(--border)',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}
