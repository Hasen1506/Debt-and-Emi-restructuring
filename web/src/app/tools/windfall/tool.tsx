'use client';

/**
 * Windfall tool — spec §4.9.1 worked example.
 *
 * Implements the §4.9 skeleton: INPUT → VERDICT (with allocation bar)
 * → MATH. The engine call + score-impact branch are unchanged from the
 * legacy implementation; only the chrome flipped from `Card` / `Stat` /
 * `VerdictHeader` to the ledger primitives.
 */

import { useId, useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import {
  api,
  formatCurrency,
  type ScoreImpactResponse,
  type WindfallResponse,
} from '@/lib/api';
import { loadProfileClient } from '@/lib/user-store';
import { useFormErrors } from '@/lib/form-errors';
import { deriveMetrics } from '@/lib/derived';
import { applyToolResult } from '@/lib/apply-tool-result';
import { loanCurrency, userDefaultCurrency } from '@/lib/currency';
import {
  LToolInput,
  LToolVerdict,
  LToolMath,
  LAllocationBar,
} from '@/components/ledger/LToolShell';
import { LBracket, L_T } from '@/components/ledger/primitives';

export function WindfallTool() {
  const profile = useMemo(() => loadProfileClient(), []);
  const country = profile.user.country;
  const loudest = useMemo(() => deriveMetrics(profile).loudest, [profile]);
  const ccy = loudest
    ? loanCurrency(loudest.loan, country)
    : userDefaultCurrency(country);
  const fmt = (v: string | number) => formatCurrency(v, ccy);

  const [amount, setAmount] = useState('');
  const [score, setScore] = useState(
    profile.creditScore != null ? String(profile.creditScore) : '',
  );
  const [v, setV] = useState<WindfallResponse | null>(null);
  const [impact, setImpact] = useState<ScoreImpactResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const { err, setErr, clear, fail, at } = useFormErrors();
  const [applied, setApplied] = useState(false);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (!amount.trim() || Number(amount) <= 0) {
      setErr('Enter the windfall amount.');
      return;
    }
    setBusy(true);
    clear();
    setImpact(null);
    setApplied(false);
    try {
      const result = await api.windfall({
        amount,
        user: profile.user,
        marginal_rate: profile.marginalRate,
        strategy: 'avalanche',
      });
      setV(result);
      if (
        !result.invest_instead &&
        result.loan_label.toLowerCase().includes('credit_card')
      ) {
        const card = profile.user.loans.find((l) => l.loan_type === 'credit_card');
        if (card) {
          const limit = new Decimal(card.outstanding).div('0.7');
          const utilFrom = new Decimal(card.outstanding).div(limit);
          const utilTo = Decimal.max(
            new Decimal(card.outstanding).minus(amount),
            new Decimal('0'),
          ).div(limit);
          const scoreInt = Number(score) || 720;
          const impactResult = await api.scoreImpact({
            action: 'utilisation_drop',
            current_score: scoreInt,
            country: 'IN',
            utilisation_from: utilFrom.toFixed(4),
            utilisation_to: utilTo.toFixed(4),
          });
          setImpact(impactResult);
        }
      }
    } catch (e) {
      fail(e, { amount: 'amount', current_score: 'score' });
    } finally {
      setBusy(false);
    }
  }

  const lender = loudest?.loan.bank?.toUpperCase() ?? 'YOUR LOUDEST DEBT';
  const loudestRate = loudest
    ? `${(Number(loudest.effective) * 100).toFixed(2)}%`
    : '—';

  // Allocation bar segments: §4.9.1 spec shows the four buckets the
  // engine routes between. The recommended bucket (the engine's verdict)
  // gets the accent tone.
  const segments = v
    ? [
        {
          label: v.invest_instead ? 'PREPAY' : 'PREPAY',
          pct: v.invest_instead ? 0 : 1,
          tone: (v.invest_instead ? 'muted' : 'accent') as
            | 'accent'
            | 'muted',
        },
        {
          label: 'INVEST',
          pct: v.invest_instead ? 1 : 0,
          tone: (v.invest_instead ? 'accent' : 'muted') as 'accent' | 'muted',
        },
        { label: 'EF', pct: 0, tone: 'muted' as const },
        { label: 'KEEP', pct: 0, tone: 'muted' as const },
      ]
    : [];

  return (
    <>
      {!profile.isLive && (
        <div
          style={{
            fontSize: 11,
            color: L_T.muted,
            letterSpacing: '0.08em',
            padding: '6px 0',
          }}
        >
          $ DEMO PROFILE · <a href="/onboarding">[SETUP →]</a>
        </div>
      )}

      <LToolInput>
        {loudest && (
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.6,
              color: L_T.muted,
              padding: '6px 10px',
              border: `1px dashed ${L_T.faint}`,
              marginBottom: 12,
            }}
          >
            ROUTES AGAINST{' '}
            <strong style={{ color: L_T.ink }}>{lender}</strong> AT{' '}
            <strong style={{ color: L_T.ink }}>{loudestRate}</strong> UNLESS
            INVESTING BEATS IT.
          </div>
        )}
        <form
          onSubmit={check}
          style={{
            display: 'grid',
            gap: 14,
            gridTemplateColumns: '1fr 1fr',
          }}
        >
          <LToolField
            label="WINDFALL AMOUNT"
            value={amount}
            onChange={setAmount}
            hint="Net of tax — what landed in your account."
            error={at('amount')}
          />
          <LToolField
            label="CURRENT CREDIT SCORE"
            value={score}
            onChange={setScore}
            hint="CIBIL / Experian. Blank skips the score-bump model."
            error={at('score')}
          />
          <div
            style={{
              gridColumn: '1 / -1',
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="submit"
              disabled={busy}
              style={{
                fontFamily:
                  "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                padding: '8px 14px',
                background: L_T.ink,
                color: L_T.paper,
                border: `1px solid ${L_T.ink}`,
                cursor: busy ? 'wait' : 'pointer',
              }}
            >
              {busy ? '[ RESOLVING… ]' : '[ WHERE SHOULD IT GO? → ]'}
            </button>
            {err && (
              <span style={{ color: L_T.negative, fontSize: 11 }}>{err}</span>
            )}
          </div>
        </form>
      </LToolInput>

      {v && (
        <LToolVerdict
          eyebrow={v.invest_instead ? 'INVEST INSTEAD' : 'PAY DOWN DEBT'}
          headline={
            v.invest_instead
              ? `INVEST IN ${(v.investment_name ?? '—').toUpperCase()}`
              : `PAY ${fmt(v.amount)} → ${v.loan_label.toUpperCase()}`
          }
          visual={<LAllocationBar segments={segments} />}
          kpi={[
            { l: 'AMOUNT', v: fmt(v.amount) },
            {
              l: v.invest_instead ? 'INTEREST GIVEN UP' : 'INTEREST AVOIDED',
              v: fmt(v.interest_avoided),
              tone: v.invest_instead ? 'neg' : 'pos',
            },
            {
              l: 'MARGINAL RATE',
              v: `${(Number(profile.marginalRate) * 100).toFixed(0)}%`,
            },
            {
              l: 'SCORE BUMP',
              v: impact
                ? `+${impact.delta_low}–${impact.delta_high}`
                : '—',
              tone: impact ? 'accent' : undefined,
            },
          ]}
          actions={
            !v.invest_instead && loudest && profile.isLive ? (
              <LBracket
                accent
                onClick={() => {
                  applyToolResult({
                    loanIndex: loudest.index,
                    kind: 'paid_extra',
                    amount: String(
                      Number(loudest.loan.scheduled_emi || 0) + Number(v.amount),
                    ),
                    scheduledEmi: loudest.loan.scheduled_emi || '0',
                    note: `Windfall applied — ${fmt(v.amount)} to ${v.loan_label}`,
                    loans: profile.user.loans,
                    country: profile.user.country,
                  });
                  setApplied(true);
                }}
              >
                {applied ? 'LOGGED ✓' : `APPLY → ${lender}`}
              </LBracket>
            ) : (
              <LBracket>EXPLORE ALTERNATIVES</LBracket>
            )
          }
        />
      )}

      {v && (
        <LToolMath
          rows={[
            { k: 'amount', v: fmt(v.amount) },
            {
              k: 'route',
              v: v.invest_instead
                ? (v.investment_name ?? '—')
                : v.loan_label,
              note: v.rationale,
            },
            {
              k: 'lender rate',
              v: loudestRate,
              note: 'effective APR, post-shield',
            },
            {
              k: 'interest avoided',
              v: fmt(v.interest_avoided),
              tone: v.invest_instead ? 'neg' : 'pos',
              note: v.invest_instead
                ? 'this is the OPPORTUNITY COST of investing'
                : 'over the loan’s remaining life, EMI kept, so it ends sooner',
            },
            {
              k: 'principal cut',
              v: v.invest_instead ? '—' : fmt(v.amount),
              note:
                Number(v.leftover) > 0
                  ? `clears the loan; ${fmt(v.leftover)} left over`
                  : 'goes directly against the outstanding',
            },
            {
              k: 'expected return',
              v: v.invest_instead && v.investment_return
                ? `${(Number(v.investment_return) * 100).toFixed(2)}%`
                : '—',
              note: v.invest_instead
                ? 'after-tax, vs the lender rate above'
                : 'invest option lost on net',
            },
          ]}
        />
      )}
    </>
  );
}

// ─── inline LField-shaped input that doesn't pull in the heavy
//     `Field` component from `ToolPrimitives` (which carries its own
//     non-ledger styling). Plain monospace input + dashed underline
//     matches the prototype. ──────────────────────────────────────────
function LToolField({
  label,
  value,
  onChange,
  hint,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  error?: string | null;
}) {
  const id = useId();
  const described = [error ? `${id}-err` : '', hint ? `${id}-hint` : ''].filter(Boolean).join(' ');
  // The label names only the input; the hint and error describe it.
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontFamily:
          "'IBM Plex Mono', 'JetBrains Mono', ui-monospace, monospace",
      }}
    >
      <label
        htmlFor={id}
        style={{
          fontSize: 9,
          letterSpacing: '0.18em',
          color: L_T.muted,
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={described || undefined}
        style={{
          background: 'transparent',
          border: 'none',
          borderBottom: `1px solid ${error ? L_T.negative : L_T.ink}`,
          padding: '6px 0',
          fontFamily: 'inherit',
          fontSize: 14,
          fontWeight: 700,
          color: L_T.ink,
        }}
      />
      {error && (
        <span id={`${id}-err`} role="alert" style={{ fontSize: 11, color: L_T.negative }}>
          {error}
        </span>
      )}
      {hint && (
        <span id={`${id}-hint`} style={{ fontSize: 10, color: L_T.muted, lineHeight: 1.5 }}>
          {hint}
        </span>
      )}
    </div>
  );
}
