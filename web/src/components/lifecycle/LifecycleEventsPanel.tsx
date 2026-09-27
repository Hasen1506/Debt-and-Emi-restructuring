'use client';

/**
 * Life Events panel — add/edit/cancel discontinuous life events the
 * regular `hike_schedule` can't express: a salary reset on a new job, a
 * floating-rate revision after an RBI repo cut, a planned home loan that
 * becomes real on its closing date.
 *
 * Cookie-backed via `lib/lifecycle-events`. Shows three controls inline:
 * a "+ Add event" toggle, a kind picker, and a small form for the chosen
 * kind. Existing events render in a list below with status badges and
 * inline actions (confirm / cancel / delete).
 *
 * Renders three skin variants from the same component — visual idiom
 * forks at the top, behaviour is shared.
 */

import { resolveLoanIndex } from '@/lib/loan-ids';
import { useEffect, useMemo, useState } from 'react';
import type { LoanPayload, LoanType, UserPayload } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import {
  readLifecycleClient,
  writeLifecycleClient,
  addLifecycleEvent,
  updateLifecycleEvent,
  removeLifecycleEvent,
  applyConfirmedEventWithRefresh,
  undoConfirmedEventWithRefresh,
  LIFECYCLE_KIND_LABEL,
  type LifecycleEvent,
  type LifecycleDraft,
  type LifecycleKind,
  type LifecycleStatus,
} from '@/lib/lifecycle-events';
import { loadProfileClient, saveProfileClient } from '@/lib/user-store';
import { percentRateError } from '@/lib/loan-gaps';

export type LifecycleVariant = 'ledger' | 'existing' | 'editorial';

const LOAN_TYPES: { value: LoanType; label: string }[] = [
  { value: 'home_loan', label: 'Home loan' },
  { value: 'auto_loan', label: 'Auto loan' },
  { value: 'personal_loan', label: 'Personal loan' },
  { value: 'education_loan', label: 'Education loan' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'gold_loan', label: 'Gold loan' },
  { value: 'bnpl', label: 'BNPL / pay-later' },
];

const STATUS_COLOR: Record<LifecycleStatus, string> = {
  planned: 'var(--accent)',
  confirmed: 'var(--positive)',
  cancelled: 'var(--muted)',
};

function blankLoanDraft(): LoanPayload {
  return {
    loan_type: 'home_loan',
    bank: '',
    outstanding: '',
    nominal_rate: '',
    rate_type: 'fixed',
    tenure_months_remaining: 0,
    scheduled_emi: '',
    processing_fee_amortised: '',
    insurance_premium_pct: '',
  };
}

export function LifecycleEventsPanel({
  user,
  variant,
}: {
  user: UserPayload;
  variant: LifecycleVariant;
}) {
  const [ready, setReady] = useState(false);
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<LifecycleKind>('salary_reset');
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [newGross, setNewGross] = useState('');
  const [newTakeHome, setNewTakeHome] = useState('');
  const [resetLoanIdx, setResetLoanIdx] = useState(0);
  const [newRatePct, setNewRatePct] = useState('');
  const [loanRatePct, setLoanRatePct] = useState('');
  const [loanDraft, setLoanDraft] = useState<LoanPayload>(blankLoanDraft());

  useEffect(() => {
    setEvents(readLifecycleClient());
    setReady(true);
  }, []);

  const ccy = user.country === 'IN' ? 'INR' : 'USD';

  const realLoans = useMemo(
    () =>
      user.loans
        .map((l, i) => ({ l, i }))
        .filter(({ l }) => Number(l.outstanding) > 0),
    [user.loans],
  );

  function resetForm() {
    setAdding(false);
    setKind('salary_reset');
    setEffectiveDate(todayIso());
    setNote('');
    setNewGross('');
    setNewTakeHome('');
    setResetLoanIdx(realLoans[0]?.i ?? 0);
    setNewRatePct('');
    setLoanRatePct('');
    setLoanDraft(blankLoanDraft());
  }

  // A rate the plan engine won't take (negative, above 100%) is named here
  // instead of breaking the plan after saving.
  const rateError =
    kind === 'floating_rate_reset'
      ? percentRateError(newRatePct)
      : kind === 'property_buy'
        ? percentRateError(loanRatePct)
        : null;

  function commit() {
    if (!effectiveDate || rateError) return;
    let draft: LifecycleDraft | null = null;
    if (kind === 'salary_reset') {
      if (Number(newGross) <= 0) return;
      draft = {
        kind: 'salary_reset',
        status: 'planned',
        effectiveDate,
        note: note.trim() || undefined,
        newAnnualGross: newGross.trim(),
        newMonthlyTakeHome: newTakeHome.trim() || undefined,
      };
    } else if (kind === 'floating_rate_reset') {
      if (realLoans.length === 0 || !newRatePct.trim()) return;
      const rate = (Number(newRatePct) / 100).toFixed(4);
      draft = {
        kind: 'floating_rate_reset',
        status: 'planned',
        effectiveDate,
        note: note.trim() || undefined,
        loanIndex: resetLoanIdx,
        ...(user.loans[resetLoanIdx]?.id ? { loanId: user.loans[resetLoanIdx].id } : {}),
        newRate: rate,
      };
    } else if (kind === 'property_buy') {
      if (Number(loanDraft.outstanding) <= 0 || !(Number(loanRatePct) > 0))
        return;
      draft = {
        kind: 'property_buy',
        status: 'planned',
        effectiveDate,
        note: note.trim() || undefined,
        // Typed as a percentage, like the rate-reset form above.
        loanDraft: { ...loanDraft, nominal_rate: (Number(loanRatePct) / 100).toFixed(4) },
      };
    }
    if (!draft) return;
    const next = addLifecycleEvent(events, draft);
    writeLifecycleClient(next);
    setEvents(next);
    resetForm();
  }

  function setStatus(id: string, status: LifecycleStatus) {
    const target = events.find((e) => e.id === id);
    if (!target) return;
    // Defense in depth: future-effective events can't be confirmed.
    if (status === 'confirmed' && target.effectiveDate > todayIso()) return;
    // planned → confirmed: apply + snapshot (also refreshes marginalRate
    // so a salary jump doesn't leave the bracket stale).
    if (status === 'confirmed' && target.status !== 'confirmed') {
      const prevMarginal = loadProfileClient().marginalRate;
      const { user: updatedUser, marginalRate, snapshot } =
        applyConfirmedEventWithRefresh(user, prevMarginal, target);
      saveProfileClient({ user: updatedUser, marginalRate });
      const next = updateLifecycleEvent(events, id, {
        status,
        appliedSnapshot: snapshot,
      });
      writeLifecycleClient(next);
      setEvents(next);
      return;
    }
    // confirmed → anything else: undo the profile mutation first
    if (target.status === 'confirmed' && status !== 'confirmed') {
      if (target.appliedSnapshot) {
        const { user: restoredUser, marginalRate } =
          undoConfirmedEventWithRefresh(user, target);
        saveProfileClient({ user: restoredUser, marginalRate });
      }
      const next = updateLifecycleEvent(events, id, {
        status,
        appliedSnapshot: undefined,
      });
      writeLifecycleClient(next);
      setEvents(next);
      return;
    }
    // No-mutation transitions (planned ↔ cancelled, etc).
    const next = updateLifecycleEvent(events, id, { status });
    writeLifecycleClient(next);
    setEvents(next);
  }

  function remove(id: string) {
    const target = events.find((e) => e.id === id);
    // Deleting a confirmed event means the profile mutation hangs around
    // forever otherwise. Undo before removing so the user gets a clean
    // revert.
    if (target?.status === 'confirmed' && target.appliedSnapshot) {
      const { user: restoredUser, marginalRate } =
        undoConfirmedEventWithRefresh(user, target);
      saveProfileClient({ user: restoredUser, marginalRate });
    }
    const next = removeLifecycleEvent(events, id);
    writeLifecycleClient(next);
    setEvents(next);
  }

  if (!ready) return null;

  const headerLabel = labelFor(variant, 'Life events');
  const introCopy = `${events.length === 0 ? 'No events yet. ' : ''}Add a salary reset, a floating-rate revision, or a planned property purchase. Planned events show an arrival prompt on /plan once their date passes.`;

  return (
    <section style={containerStyle(variant)}>
      <div style={headerStyle(variant)}>{headerLabel}</div>
      <div style={introStyle(variant)}>{introCopy}</div>

      <div style={{ marginTop: 12 }}>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setResetLoanIdx(realLoans[0]?.i ?? 0);
            }}
            style={primaryBtn(variant)}
          >
            + Add life event
          </button>
        )}

        {adding && (
          <div style={formCardStyle(variant)}>
            <div style={fieldRowStyle()}>
              <label style={labelStyle(variant)}>
                Event kind
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as LifecycleKind)}
                  style={inputStyle(variant)}
                >
                  <option value="salary_reset">Salary reset</option>
                  <option value="floating_rate_reset">
                    Floating-rate reset
                  </option>
                  <option value="property_buy">New loan / property</option>
                </select>
              </label>
              <label style={labelStyle(variant)}>
                Effective date
                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  style={inputStyle(variant)}
                />
              </label>
            </div>

            {kind === 'salary_reset' && (
              <div style={fieldRowStyle()}>
                <label style={labelStyle(variant)}>
                  New annual gross ({ccy})
                  <input
                    type="number"
                    value={newGross}
                    onChange={(e) => setNewGross(e.target.value)}
                    placeholder="e.g. 3200000"
                    style={inputStyle(variant)}
                  />
                </label>
                <label style={labelStyle(variant)}>
                  Monthly take-home (optional)
                  <input
                    type="number"
                    value={newTakeHome}
                    onChange={(e) => setNewTakeHome(e.target.value)}
                    placeholder="leave blank to derive from gross"
                    style={inputStyle(variant)}
                  />
                </label>
              </div>
            )}

            {kind === 'floating_rate_reset' && (
              <div style={fieldRowStyle()}>
                <label style={labelStyle(variant)}>
                  Loan
                  {realLoans.length === 0 ? (
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--muted)',
                        padding: '8px 0',
                      }}
                    >
                      No loans on file. Add one in setup first.
                    </div>
                  ) : (
                    <select
                      value={resetLoanIdx}
                      onChange={(e) => setResetLoanIdx(Number(e.target.value))}
                      style={inputStyle(variant)}
                    >
                      {realLoans.map(({ l, i }) => (
                        <option key={i} value={i}>
                          {l.bank || '—'} {l.loan_type.replace('_', ' ')} ·{' '}
                          {formatCurrency(l.outstanding, ccy)}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
                <label style={labelStyle(variant)}>
                  New nominal rate (%)
                  <input
                    type="number"
                    step="0.01"
                    value={newRatePct}
                    onChange={(e) => setNewRatePct(e.target.value)}
                    placeholder="e.g. 8.40"
                    aria-invalid={rateError ? true : undefined}
                    style={inputStyle(variant)}
                  />
                  {rateError && (
                    <span role="alert" style={{ fontSize: 11, color: 'var(--negative)' }}>
                      {rateError}
                    </span>
                  )}
                </label>
              </div>
            )}

            {kind === 'property_buy' && (
              <>
                <div style={fieldRowStyle()}>
                  <label style={labelStyle(variant)}>
                    Loan type
                    <select
                      value={loanDraft.loan_type}
                      onChange={(e) =>
                        setLoanDraft({
                          ...loanDraft,
                          loan_type: e.target.value as LoanType,
                        })
                      }
                      style={inputStyle(variant)}
                    >
                      {LOAN_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={labelStyle(variant)}>
                    Bank
                    <input
                      type="text"
                      value={loanDraft.bank}
                      onChange={(e) =>
                        setLoanDraft({ ...loanDraft, bank: e.target.value })
                      }
                      placeholder="e.g. HDFC"
                      style={inputStyle(variant)}
                    />
                  </label>
                </div>
                <div style={fieldRowStyle()}>
                  <label style={labelStyle(variant)}>
                    Principal ({ccy})
                    <input
                      type="number"
                      value={loanDraft.outstanding}
                      onChange={(e) =>
                        setLoanDraft({
                          ...loanDraft,
                          outstanding: e.target.value,
                        })
                      }
                      placeholder="e.g. 5000000"
                      style={inputStyle(variant)}
                    />
                  </label>
                  <label style={labelStyle(variant)}>
                    Interest rate (%)
                    <input
                      type="number"
                      step="0.01"
                      value={loanRatePct}
                      onChange={(e) => setLoanRatePct(e.target.value)}
                      placeholder="e.g. 8.5"
                      aria-invalid={rateError ? true : undefined}
                      style={inputStyle(variant)}
                    />
                    {rateError && (
                      <span role="alert" style={{ fontSize: 11, color: 'var(--negative)' }}>
                        {rateError}
                      </span>
                    )}
                  </label>
                </div>
                <div style={fieldRowStyle()}>
                  <label style={labelStyle(variant)}>
                    Tenure (months)
                    <input
                      type="number"
                      value={loanDraft.tenure_months_remaining || ''}
                      onChange={(e) =>
                        setLoanDraft({
                          ...loanDraft,
                          tenure_months_remaining: Number(e.target.value) || 0,
                        })
                      }
                      placeholder="e.g. 240"
                      style={inputStyle(variant)}
                    />
                  </label>
                  <label style={labelStyle(variant)}>
                    Scheduled EMI ({ccy})
                    <input
                      type="number"
                      value={loanDraft.scheduled_emi}
                      onChange={(e) =>
                        setLoanDraft({
                          ...loanDraft,
                          scheduled_emi: e.target.value,
                        })
                      }
                      style={inputStyle(variant)}
                    />
                  </label>
                </div>
              </>
            )}

            <label style={labelStyle(variant)}>
              Note (optional)
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. New job at TCS, offer signed"
                style={inputStyle(variant)}
              />
            </label>

            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" onClick={commit} style={primaryBtn(variant)}>
                Save event
              </button>
              <button type="button" onClick={resetForm} style={secondaryBtn(variant)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {events.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {events.map((e) => (
            <EventRow
              key={e.id}
              event={e}
              user={user}
              variant={variant}
              onConfirm={() => setStatus(e.id, 'confirmed')}
              onCancel={() => setStatus(e.id, 'cancelled')}
              onReopen={() => setStatus(e.id, 'planned')}
              onRemove={() => remove(e.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function EventRow({
  event: e,
  user,
  variant,
  onConfirm,
  onCancel,
  onReopen,
  onRemove,
}: {
  event: LifecycleEvent;
  user: UserPayload;
  variant: LifecycleVariant;
  onConfirm: () => void;
  onCancel: () => void;
  onReopen: () => void;
  onRemove: () => void;
}) {
  const ccy = user.country === 'IN' ? 'INR' : 'USD';
  const status = e.status;
  const isPast = e.effectiveDate <= todayIso();
  const kindLabel = LIFECYCLE_KIND_LABEL[e.kind];

  let summary = '';
  if (e.kind === 'salary_reset') {
    summary = `New gross ${formatCurrency(e.newAnnualGross, ccy)}/yr`;
    if (e.newMonthlyTakeHome) {
      summary += ` · take-home ${formatCurrency(e.newMonthlyTakeHome, ccy)}/mo`;
    }
  } else if (e.kind === 'floating_rate_reset') {
    const loan = user.loans[resolveLoanIndex(e, user.loans)];
    const lender = loan ? loan.bank || loan.loan_type : 'a loan since removed';
    summary = `${lender} → ${(Number(e.newRate) * 100).toFixed(2)}%`;
  } else if (e.kind === 'property_buy') {
    const d = e.loanDraft;
    summary = `${d.bank || 'New loan'} ${d.loan_type.replace('_', ' ')} · ${formatCurrency(d.outstanding, ccy)} @ ${(Number(d.nominal_rate) * 100).toFixed(2)}%`;
  }

  return (
    <div style={rowStyle(variant, status)}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: 10,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '2px 8px',
              borderRadius: 999,
              border: `1px solid ${STATUS_COLOR[status]}`,
              color: STATUS_COLOR[status],
            }}
          >
            {status}
          </span>
          <strong>{kindLabel}</strong>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>
            {e.effectiveDate}
          </span>
          {status === 'planned' && isPast && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--accent)',
                fontStyle: 'italic',
              }}
            >
              — arrival date passed
            </span>
          )}
        </div>
        <div style={{ fontSize: 13 }}>{summary}</div>
        {e.note && (
          <div className="muted" style={{ fontSize: 12, fontStyle: 'italic' }}>
            {e.note}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {status === 'planned' && (
          <>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!isPast}
              title={isPast ? 'Mark as happened' : `Can't confirm yet — effective date is in the future (${e.effectiveDate})`}
              style={{ ...miniBtn(variant, true), opacity: isPast ? 1 : 0.45, cursor: isPast ? 'pointer' : 'not-allowed' }}
            >
              Confirm
            </button>
            <button type="button" onClick={onCancel} style={miniBtn(variant, false)}>
              Cancel
            </button>
          </>
        )}
        {status !== 'planned' && (
          <button type="button" onClick={onReopen} style={miniBtn(variant, false)}>
            Reopen
          </button>
        )}
        <button type="button" onClick={onRemove} style={miniBtn(variant, false)} aria-label="Delete">
          ×
        </button>
      </div>
    </div>
  );
}

// ─── styling helpers (variant-aware, kept inline for parity) ────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function labelFor(variant: LifecycleVariant, fallback: string): string {
  if (variant === 'ledger') return '$ LIFE EVENTS';
  if (variant === 'editorial') return 'Life events · the discontinuities';
  return fallback;
}

function containerStyle(variant: LifecycleVariant): React.CSSProperties {
  if (variant === 'ledger') {
    return {
      fontFamily: 'var(--font-mono)',
      fontSize: 12,
      lineHeight: 1.55,
    };
  }
  if (variant === 'editorial') {
    return {
      borderTop: '1px solid var(--border)',
      paddingTop: 20,
    };
  }
  return {};
}

function headerStyle(variant: LifecycleVariant): React.CSSProperties {
  if (variant === 'ledger') {
    return {
      fontSize: 11,
      color: 'var(--muted)',
      letterSpacing: '0.18em',
      marginBottom: 6,
    };
  }
  if (variant === 'editorial') {
    return {
      fontFamily: 'var(--font-sans)',
      fontSize: 11,
      letterSpacing: '0.15em',
      textTransform: 'uppercase',
      color: 'var(--soft)',
      marginBottom: 8,
    };
  }
  return { fontSize: 16, fontWeight: 600, marginBottom: 4 };
}

function introStyle(variant: LifecycleVariant): React.CSSProperties {
  if (variant === 'ledger') {
    return {
      fontSize: 11,
      color: 'var(--muted)',
      letterSpacing: '0.04em',
      lineHeight: 1.65,
      background: 'var(--card)',
      border: '1px dashed var(--border)',
      padding: '10px 12px',
    };
  }
  if (variant === 'editorial') {
    return {
      fontFamily: 'var(--font-display)',
      fontSize: 14,
      fontStyle: 'italic',
      color: 'var(--muted)',
      lineHeight: 1.6,
    };
  }
  return { fontSize: 13, color: 'var(--muted)', lineHeight: 1.55 };
}

function primaryBtn(variant: LifecycleVariant): React.CSSProperties {
  if (variant === 'ledger') {
    return {
      padding: '8px 14px',
      border: '1px solid var(--ink)',
      background: 'var(--ink)',
      color: 'var(--canvas)',
      fontSize: 11,
      letterSpacing: '0.12em',
      cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
    };
  }
  return {
    padding: '8px 14px',
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
  };
}

function secondaryBtn(variant: LifecycleVariant): React.CSSProperties {
  if (variant === 'ledger') {
    return {
      padding: '8px 14px',
      border: '1px solid var(--ink)',
      background: 'var(--canvas)',
      color: 'var(--ink)',
      fontSize: 11,
      letterSpacing: '0.12em',
      cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
    };
  }
  return {
    padding: '8px 14px',
    background: 'transparent',
    color: 'var(--muted)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    fontSize: 13,
    cursor: 'pointer',
  };
}

function miniBtn(variant: LifecycleVariant, primary: boolean): React.CSSProperties {
  if (variant === 'ledger') {
    return {
      padding: '4px 10px',
      border: '1px solid var(--ink)',
      background: primary ? 'var(--ink)' : 'var(--canvas)',
      color: primary ? 'var(--canvas)' : 'var(--ink)',
      fontSize: 10,
      letterSpacing: '0.12em',
      cursor: 'pointer',
      fontFamily: 'var(--font-mono)',
    };
  }
  return {
    padding: '4px 10px',
    background: primary ? 'var(--accent)' : 'transparent',
    color: primary ? '#fff' : 'var(--muted)',
    border: primary ? 'none' : '1px solid var(--border)',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer',
  };
}

function formCardStyle(variant: LifecycleVariant): React.CSSProperties {
  return {
    marginTop: 12,
    padding: 14,
    background: 'var(--card)',
    border:
      variant === 'ledger' ? '1px solid var(--ink)' : '1px solid var(--border)',
    borderRadius: variant === 'ledger' ? 0 : 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  };
}

function fieldRowStyle(): React.CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
  };
}

function labelStyle(variant: LifecycleVariant): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: variant === 'ledger' ? 11 : 12,
    color: 'var(--muted)',
    letterSpacing: variant === 'ledger' ? '0.08em' : 'normal',
    textTransform: variant === 'ledger' ? 'uppercase' : 'none',
  };
}

function inputStyle(variant: LifecycleVariant): React.CSSProperties {
  return {
    padding: variant === 'ledger' ? '6px 8px' : '8px 10px',
    background: 'var(--canvas)',
    border:
      variant === 'ledger' ? '1px solid var(--ink)' : '1px solid var(--border)',
    borderRadius: variant === 'ledger' ? 0 : 4,
    fontSize: 13,
    color: 'var(--ink)',
    fontFamily: variant === 'ledger' ? 'var(--font-mono)' : 'inherit',
  };
}

function rowStyle(
  variant: LifecycleVariant,
  status: LifecycleStatus,
): React.CSSProperties {
  return {
    padding: 12,
    background: 'var(--card)',
    border:
      variant === 'ledger'
        ? '1px solid var(--ink)'
        : `1px solid var(--border)`,
    borderLeft: `3px solid ${STATUS_COLOR[status]}`,
    borderRadius: variant === 'ledger' ? 0 : 6,
    display: 'flex',
    gap: 12,
    alignItems: 'flex-start',
    opacity: status === 'cancelled' ? 0.6 : 1,
  };
}
