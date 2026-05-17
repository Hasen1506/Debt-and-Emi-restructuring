'use client';

/**
 * Top-of-page summary KPIs for /insights — surfaces the audit-trail
 * health at a glance.
 *
 * Reads two client-side stores: the activity ledger (localStorage,
 * payment events) and the advance-tax schedule (cookie, quarterly
 * instalments). Computes counts + total penalty estimate and renders
 * in the active skin's idiom.
 *
 * Renders nothing while the client is hydrating (entries are read in
 * a `useEffect`) — avoids SSR/CSR mismatches.
 */

import { useEffect, useState } from 'react';
import type { UserPayload } from '@/lib/api';
import { formatCurrency } from '@/lib/api';
import { readActivityClient, type ActivityEntry } from '@/lib/activity';
import { readScheduleClient } from '@/lib/advance-tax-cookie';
import type { AdvanceTaxSchedule } from '@/lib/advance-tax';
import { estimateLateFee } from '@/lib/estimate-penalty';

type Variant = 'ledger' | 'existing' | 'editorial';

interface Summary {
  entriesCount: number;
  paidFull: number;
  paidPartial: number;
  missed: number;
  paidExtra: number;
  totalPenalty: number;
  advanceTaxPaid: number;
  advanceTaxMissed: number;
  advanceTaxTotal: number;
}

function computeSummary(
  entries: ActivityEntry[],
  user: UserPayload,
  schedule: AdvanceTaxSchedule | null,
): Summary {
  const real = entries.filter((e) => e.loanIndex >= 0);
  let totalPenalty = 0;
  let paidFull = 0;
  let paidPartial = 0;
  let missed = 0;
  let paidExtra = 0;
  for (const e of real) {
    if (e.kind === 'paid_full') paidFull++;
    else if (e.kind === 'paid_partial') paidPartial++;
    else if (e.kind === 'missed') missed++;
    else if (e.kind === 'paid_extra') paidExtra++;

    if (e.kind === 'paid_partial' || e.kind === 'missed') {
      // Honour the user's override when present, else derive a fresh estimate
      // using the same engine as the ledger detail row.
      if (e.penaltyOverride && e.penaltyOverride.trim() !== '') {
        const v = Number(e.penaltyOverride);
        if (Number.isFinite(v)) totalPenalty += v;
      } else {
        const loan = user.loans[e.loanIndex];
        if (loan) {
          const shortfall =
            e.kind === 'missed'
              ? Number(e.scheduledEmi)
              : Math.max(0, Number(e.scheduledEmi) - Number(e.amount));
          if (shortfall > 0) {
            const dueDate = new Date(e.date);
            const now = new Date();
            const diffMs = now.getTime() - dueDate.getTime();
            const days =
              diffMs <= 0 ? 1 : Math.max(1, Math.floor(diffMs / 86400000));
            const est = estimateLateFee({
              loanType: loan.loan_type,
              country: user.country,
              bank: loan.bank,
              overdueAmount: String(shortfall),
              daysLate: days,
            });
            totalPenalty += Number(est.total.toString());
          }
        }
      }
    }
  }

  const advanceTaxPaid =
    schedule?.instalments.filter((i) => i.status === 'paid').length ?? 0;
  const advanceTaxMissed =
    schedule?.instalments.filter((i) => i.status === 'missed').length ?? 0;
  const advanceTaxTotal = schedule?.instalments.length ?? 0;

  return {
    entriesCount: real.length,
    paidFull,
    paidPartial,
    missed,
    paidExtra,
    totalPenalty,
    advanceTaxPaid,
    advanceTaxMissed,
    advanceTaxTotal,
  };
}

export function InsightsSummaryStrip({
  user,
  variant,
}: {
  user: UserPayload;
  variant: Variant;
}) {
  const [ready, setReady] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    const entries = readActivityClient();
    const schedule = readScheduleClient();
    setSummary(computeSummary(entries, user, schedule));
    setReady(true);
    // Re-read when the user navigates back to this page after editing.
    function onFocus() {
      const next = readActivityClient();
      const nextSched = readScheduleClient();
      setSummary(computeSummary(next, user, nextSched));
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user]);

  if (!ready || !summary) return null;
  if (summary.entriesCount === 0 && summary.advanceTaxTotal === 0) {
    // Nothing recorded yet — surface an empty-state hint instead of zeros
    // across the board, which would look broken.
    return <EmptyState variant={variant} />;
  }

  const ccy = user.country === 'IN' ? 'INR' : 'USD';
  const penaltyLabel = formatCurrency(summary.totalPenalty.toFixed(0), ccy);

  if (variant === 'ledger') {
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
          $ AUDIT · AT A GLANCE
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 1,
            background: 'var(--ink)',
            padding: 1,
          }}
        >
          {[
            {
              l: 'ENTRIES LOGGED',
              v: String(summary.entriesCount),
              sub:
                summary.paidFull > 0 || summary.paidExtra > 0
                  ? `${summary.paidFull + summary.paidExtra} PAID · ${summary.paidPartial} PARTIAL · ${summary.missed} MISSED`
                  : 'GET STARTED BELOW',
              c: 'var(--ink)',
            },
            {
              l: 'PENALTIES ACCRUED',
              v: penaltyLabel,
              sub:
                summary.totalPenalty > 0
                  ? 'ESTIMATED FROM BANK SCHEDULES'
                  : 'CLEAN RECORD · NO SHORTFALL',
              c:
                summary.totalPenalty > 0
                  ? 'var(--negative)'
                  : 'var(--positive)',
            },
            {
              l: 'ADVANCE TAX',
              v:
                summary.advanceTaxTotal > 0
                  ? `${summary.advanceTaxPaid}/${summary.advanceTaxTotal}`
                  : '—',
              sub:
                summary.advanceTaxTotal > 0
                  ? `${summary.advanceTaxMissed} MISSED`
                  : 'NOT APPLICABLE',
              c:
                summary.advanceTaxMissed > 0
                  ? 'var(--negative)'
                  : 'var(--ink)',
            },
            {
              l: 'AUDIT TRAIL',
              v: `${summary.entriesCount + (summary.advanceTaxPaid + summary.advanceTaxMissed)}`,
              sub: 'TOTAL EVENTS ON FILE',
              c: 'var(--ink)',
            },
          ].map((s) => (
            <div
              key={s.l}
              style={{ background: 'var(--canvas)', padding: '10px 12px' }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--muted)',
                  letterSpacing: '0.12em',
                  marginBottom: 4,
                }}
              >
                {s.l}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: s.c }}>
                {s.v}
              </div>
              <div
                style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}
              >
                {s.sub}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (variant === 'editorial') {
    return (
      <div
        style={{
          marginTop: 28,
          padding: '20px 0',
          borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 24,
        }}
      >
        {[
          {
            v: String(summary.entriesCount),
            l: `entries on file · ${summary.paidFull + summary.paidExtra} paid, ${summary.paidPartial} partial, ${summary.missed} missed`,
          },
          {
            v: penaltyLabel,
            l:
              summary.totalPenalty > 0
                ? 'in estimated penalties accrued'
                : 'no shortfall — a clean record',
          },
          {
            v:
              summary.advanceTaxTotal > 0
                ? `${summary.advanceTaxPaid} of ${summary.advanceTaxTotal}`
                : '—',
            l:
              summary.advanceTaxTotal > 0
                ? `quarterly instalments paid${summary.advanceTaxMissed > 0 ? ` · ${summary.advanceTaxMissed} missed` : ''}`
                : 'advance tax not applicable',
          },
        ].map((s) => (
          <div key={s.l}>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 26,
                fontWeight: 500,
                lineHeight: 1.1,
                color: 'var(--ink)',
              }}
            >
              {s.v}
            </div>
            <div
              className="muted"
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 11,
                marginTop: 6,
                letterSpacing: '0.04em',
              }}
            >
              {s.l}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // existing variant
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12,
      }}
    >
      <Card>
        <div className="muted" style={{ fontSize: 12 }}>
          Entries on file
        </div>
        <div className="num" style={{ fontSize: 22, fontWeight: 600 }}>
          {summary.entriesCount}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {summary.paidFull + summary.paidExtra} paid · {summary.paidPartial}{' '}
          partial · {summary.missed} missed
        </div>
      </Card>
      <Card>
        <div className="muted" style={{ fontSize: 12 }}>
          Penalties estimated
        </div>
        <div
          className="num"
          style={{
            fontSize: 22,
            fontWeight: 600,
            color:
              summary.totalPenalty > 0
                ? 'var(--negative)'
                : 'var(--positive)',
          }}
        >
          {penaltyLabel}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {summary.totalPenalty > 0
            ? 'from bank Schedule of Charges'
            : 'no shortfall recorded'}
        </div>
      </Card>
      <Card>
        <div className="muted" style={{ fontSize: 12 }}>
          Advance-tax instalments
        </div>
        <div
          className="num"
          style={{
            fontSize: 22,
            fontWeight: 600,
            color:
              summary.advanceTaxMissed > 0 ? 'var(--negative)' : 'var(--ink)',
          }}
        >
          {summary.advanceTaxTotal > 0
            ? `${summary.advanceTaxPaid} / ${summary.advanceTaxTotal}`
            : '—'}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {summary.advanceTaxTotal > 0
            ? `${summary.advanceTaxMissed} missed · ${summary.advanceTaxTotal - summary.advanceTaxPaid - summary.advanceTaxMissed} upcoming`
            : 'not applicable'}
        </div>
      </Card>
    </div>
  );
}

// Local Card so we don't pull from @/components/Card and trigger an
// extra client-bundle import.
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      {children}
    </div>
  );
}

function EmptyState({ variant }: { variant: Variant }) {
  const msg =
    'Nothing recorded yet. Log payment events below so this page becomes your audit trail — every paid, partial, missed, or extra payment, plus advance-tax instalments.';
  if (variant === 'ledger') {
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
          $ AUDIT · AT A GLANCE
        </div>
        <div
          style={{
            background: 'var(--card)',
            border: '1px dashed var(--border)',
            padding: '12px 14px',
            fontSize: 12,
            color: 'var(--muted)',
            lineHeight: 1.6,
          }}
        >
          {msg}
        </div>
      </section>
    );
  }
  if (variant === 'editorial') {
    return (
      <p
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 14,
          fontStyle: 'italic',
          color: 'var(--muted)',
          lineHeight: 1.6,
          marginTop: 28,
          paddingTop: 20,
          borderTop: '1px solid var(--border)',
        }}
      >
        {msg}
      </p>
    );
  }
  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px dashed var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: 14,
        fontSize: 13,
        color: 'var(--muted)',
        lineHeight: 1.6,
      }}
    >
      {msg}
    </div>
  );
}
