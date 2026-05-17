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
import type { RestructuringOpportunity } from '@/lib/api';
import type { CurrencyCode } from '@/lib/currency';

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
