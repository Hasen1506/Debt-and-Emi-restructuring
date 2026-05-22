'use client';

/**
 * "Better available elsewhere" hint shown beneath a restructuring
 * opportunity card.
 *
 * The primary recommendation steers the user to a bank they already deal
 * with (no fresh KYC, no new-account fee). When the all-banks rate-card
 * winner is *different and meaningfully cheaper*, this component surfaces
 * it as a low-key, dismissable line — not the headline. The user explicitly
 * acknowledging "open a new account" is a different decision from "refi
 * with my existing bank", and the UI should reflect that.
 *
 * Dismissal is session-scoped only — no localStorage persistence. Next
 * /plan visit, the hint reappears in case rate-cards or relationships
 * have shifted.
 */
import { useState } from 'react';
import { formatCurrency } from '@/lib/api';
import type { RestructuringOpportunity, UserPayload } from '@/lib/api';
import type { CurrencyCode } from '@/lib/currency';
import { UpdateRestructureModal } from './UpdateRestructureModal';

interface Props {
  opportunity: RestructuringOpportunity;
  /** Theme tag — light style tweaks so the hint feels at home in each home
   *  variant. The data and dismiss behavior are identical across themes. */
  variant?: 'existing' | 'ledger' | 'editorial';
  /** Currency to format saving amounts in; falls back to INR. */
  currency?: CurrencyCode;
}

export function OpportunityAlternative({ opportunity, variant = 'existing', currency = 'INR' }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (!opportunity.alternative_target_bank || dismissed) return null;

  const altBank = opportunity.alternative_target_bank;
  const altSaving = opportunity.alternative_annual_saving;
  const baseSaving = opportunity.estimated_annual_saving;
  const extraSaving =
    altSaving != null && baseSaving != null
      ? Number(altSaving) - Number(baseSaving)
      : null;

  // If the alternative doesn't actually save more after the override, hide
  // it — the engine should normally filter this out but UI guards too.
  if (extraSaving != null && extraSaving <= 0) return null;

  const mono = variant === 'ledger';

  return (
    <div
      style={{
        marginTop: 8,
        padding: '8px 12px',
        fontSize: 12,
        lineHeight: 1.55,
        background: 'var(--soft-bg)',
        border: '1px dashed var(--border)',
        borderRadius: variant === 'ledger' ? 0 : 6,
        color: 'var(--muted)',
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        Also worth knowing — <strong style={{ color: 'var(--ink)' }}>{altBank}</strong>{' '}
        offers an even lower rate
        {extraSaving != null && extraSaving > 0 && (
          <>
            {' '}(save another{' '}
            <strong style={{ color: 'var(--positive)' }}>
              {formatCurrency(extraSaving, currency)}/yr
            </strong>
            )
          </>
        )}
        . Requires opening a new account.{' '}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--accent)',
            padding: 0,
            cursor: 'pointer',
            fontSize: 12,
            textDecoration: 'underline',
            fontFamily: 'inherit',
          }}
        >
          {expanded ? 'hide details' : 'show details'}
        </button>
        {expanded && (
          <div
            style={{
              marginTop: 6,
              padding: '6px 0',
              color: 'var(--ink)',
              fontSize: 12,
            }}
          >
            Switching to {altBank} would cost you the friction of fresh KYC,
            a processing fee, and possibly a relationship-discount loss at
            your current bank
            {opportunity.target_bank ? ` (${opportunity.target_bank})` : ''}.
            If you&apos;re willing to absorb that, the rate gap can be worth
            it on larger balances — but the &ldquo;saved/yr&rdquo; figure
            above already includes the bank you actually use.
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss alternative"
        title="Dismiss this alternative for the session"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--muted)',
          fontSize: 16,
          cursor: 'pointer',
          padding: 0,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ×
      </button>
    </div>
  );
}

/**
 * Trigger button: "I took this — update terms" on an opportunity card.
 * Opens the UpdateRestructureModal so the user can record the actual
 * negotiated terms (rates often drift a few bps from advertised). Only
 * renders when the opportunity has a known affected_loan_index, since
 * we need that pointer to know which loan(s) to mutate.
 */
export function UpdateTermsButton({
  opportunity,
  user,
  currency,
  variant = 'existing',
}: {
  opportunity: RestructuringOpportunity;
  user: UserPayload;
  currency: CurrencyCode;
  variant?: 'existing' | 'ledger' | 'editorial';
}) {
  const [open, setOpen] = useState(false);
  const indices = opportunity.affected_loan_indices ?? [];
  if (indices.length === 0) return null;

  const mono = variant === 'ledger';
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          marginTop: 6,
          padding: '4px 10px',
          background: 'transparent',
          border: '1px solid var(--accent)',
          color: 'var(--accent)',
          borderRadius: variant === 'ledger' ? 0 : 4,
          cursor: 'pointer',
          fontSize: 11,
          fontWeight: 600,
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          letterSpacing: mono ? '0.06em' : undefined,
          textTransform: mono ? 'uppercase' : undefined,
        }}
      >
        I took this — update terms
      </button>
      {open && (
        <UpdateRestructureModal
          opportunity={opportunity}
          user={user}
          currency={currency}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Eligibility caveat — a single muted line under an opportunity card that
 * makes the user-level dependencies explicit. The rate-card numbers we
 * recommend assume the user qualifies at the *advertised* rate, but actual
 * offers re-price against credit score, employer tier, DTI, and (for SE)
 * ITR vintage — none of which we have full inputs for today.
 *
 * Rather than hide the rec or pretend it's gospel, this surfaces the
 * dependency so the user knows to verify before banking on the saving
 * number. Matches the indicative-vs-verified gradient we use elsewhere
 * (True-APR fields, RateAsOfBadge).
 */
export function EligibilityCaveat({
  kind,
  country,
  variant = 'existing',
}: {
  kind: 'balance_transfer' | 'consolidation' | 'refinance';
  country: 'IN' | 'US';
  variant?: 'existing' | 'ledger' | 'editorial';
}) {
  const isIN = country === 'IN';
  const scoreLabel = isIN ? 'CIBIL/Experian score' : 'FICO/VantageScore';
  const incomeFactor = isIN
    ? 'employer category + (if self-employed) 2–3 yrs ITR + GST returns'
    : 'employer category + DTI + W-2 history (or Schedule C if SE)';
  const kindNote =
    kind === 'balance_transfer'
      ? 'Card issuers also weigh utilisation and on-time history — limit + promo eligibility can be partial.'
      : kind === 'consolidation'
      ? 'Personal-loan underwriting is the strictest of the three; expect a fresh ITR/W-2 review.'
      : 'Refinance underwriting re-runs end-to-end as if it were a new loan, including a fresh credit pull.';

  const mono = variant === 'ledger';
  return (
    <div
      style={{
        marginTop: 6,
        padding: '6px 10px',
        fontSize: 11,
        lineHeight: 1.5,
        background: 'transparent',
        border: '1px dotted var(--border)',
        borderRadius: variant === 'ledger' ? 0 : 4,
        color: 'var(--muted)',
        fontFamily: mono ? 'var(--font-mono)' : undefined,
      }}
    >
      <strong style={{ color: 'var(--muted-ink, var(--muted))' }}>Indicative</strong>
      {' — your actual offer keys off your '}
      {scoreLabel}, {incomeFactor}. Quoted rate is the bank&apos;s advertised
      best/typical end for your income type; underwriting may re-price.
      {' '}{kindNote}{' '}Apply to confirm before banking on the saving figure.
    </div>
  );
}

/**
 * Small "you already bank with this lender" tag rendered next to the
 * opportunity's target bank when `target_is_existing_relationship` is true.
 */
export function RelationshipBadge({
  variant = 'existing',
}: {
  variant?: 'existing' | 'ledger' | 'editorial';
}) {
  return (
    <span
      style={{
        marginLeft: 6,
        padding: '2px 6px',
        fontSize: 10,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        background: 'var(--positive-soft, rgba(0,150,80,0.1))',
        color: 'var(--positive)',
        borderRadius: variant === 'ledger' ? 0 : 4,
        fontWeight: 600,
        fontFamily: variant === 'ledger' ? 'var(--font-mono)' : undefined,
      }}
    >
      your bank
    </span>
  );
}

/**
 * "Rate as of {date}" tag rendered next to opportunity rows when the
 * recommendation draws from a rate-card lookup. Visibly grounds the
 * number in a date so users can judge freshness without clicking
 * through to the rate-card source.
 */
export function RateAsOfBadge({
  asOf,
  variant = 'existing',
}: {
  asOf: string | null | undefined;
  variant?: 'existing' | 'ledger' | 'editorial';
}) {
  if (!asOf) return null;
  let label: string;
  try {
    label = new Date(asOf).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    label = asOf;
  }
  return (
    <span
      title={`Rate-card last verified ${label}. Updates each batch refresh — quarterly cadence today, partner-API live feed once that ships.`}
      style={{
        marginLeft: 6,
        padding: '2px 6px',
        fontSize: 10,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        background: 'transparent',
        color: 'var(--muted)',
        border: '1px solid var(--border)',
        borderRadius: variant === 'ledger' ? 0 : 4,
        fontFamily: variant === 'ledger' ? 'var(--font-mono)' : undefined,
        cursor: 'help',
      }}
    >
      as of {label}
    </span>
  );
}
