'use client';

/**
 * "Your EMI is about to free up — where do you want it to go?" banner.
 *
 * Catches the highest-leverage moment in the user's debt journey: the
 * month where they go from servicing debt to having that cash flow back.
 * Without an active prompt, most people quietly absorb the freed money
 * into lifestyle inflation. Capturing the moment — and pre-deciding where
 * the cash routes — is what turns a debtor into an investor.
 *
 * Visibility rules:
 *   • Shows when `plan.debtFreeMonth` is set AND within 12 months ahead.
 *   • Hidden when there are no loans (nothing to free up).
 *   • Hidden when the user has dismissed it for the session.
 *
 * Note: the engine simulates forward from today, so `debtFreeMonth` is
 * always ≥ 1 when present — there's no "past" case to detect here. A
 * landed debt-free moment is captured by the activity log instead.
 *
 * Freed amount = total scheduled EMI today across all positive-balance
 * loans. This is what'll stop draining once everything clears. It's not
 * the same as surplus (which also includes any extra they were already
 * routing); but it's the conceptually clean number to show the user.
 *
 * Actions are navigational, not destructive — we don't auto-create
 * anything. The user clicks "Plan a goal" or "Top up EF" and the
 * destination page handles the rest. Keeping the prompt opinion-free
 * means it works for every persona.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatCurrency } from '@/lib/api';
import { monthIndexToCountryLabel } from '@/lib/today';
import type { PlanData } from './PlanData';

const DISMISS_KEY = 'finoptima_debtfree_prompt_dismissed';

export function DebtFreeRedirectPrompt({
  plan,
  variant = 'existing',
}: {
  plan: PlanData;
  variant?: 'existing' | 'ledger' | 'editorial';
}) {
  const [dismissed, setDismissed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    if (typeof sessionStorage === 'undefined') return;
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  function dismiss() {
    setDismissed(true);
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(DISMISS_KEY, '1');
    }
  }

  if (!hydrated) return null;
  if (dismissed) return null;
  if (plan.debtFreeMonth == null) return null;

  const monthsAway = plan.debtFreeMonth;
  // Far-future doesn't need this nudge — only show inside the 12-month band.
  if (monthsAway > 12) return null;

  const freedMonthlyEmi = plan.user.loans
    .filter((l) => Number(l.outstanding || 0) > 0)
    .reduce((s, l) => s + Number(l.scheduled_emi || 0), 0);
  if (freedMonthlyEmi <= 0) return null;

  const dateLabel = monthIndexToCountryLabel(
    plan.debtFreeMonth,
    plan.user.country,
  );
  const freedAmountLabel = formatCurrency(
    String(Math.round(freedMonthlyEmi)),
    plan.displayCurrency,
  );

  const headline = `In ${monthsAway} ${monthsAway === 1 ? 'month' : 'months'} (${dateLabel}), your last EMI clears. ${freedAmountLabel}/mo of cash flow comes back.`;
  const sub =
    "Pre-decide where it goes now — habits set on the freed-cash moment tend to stick.";

  const mono = variant === 'ledger';

  return (
    <div
      style={{
        margin: '10px 0 14px',
        padding: '12px 14px',
        background: 'var(--soft-bg, rgba(0, 150, 80, 0.06))',
        border: '1px solid var(--positive)',
        borderRadius: variant === 'ledger' ? 0 : 6,
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: mono ? 11 : 12,
              letterSpacing: mono ? '0.08em' : '0.04em',
              textTransform: 'uppercase',
              color: 'var(--positive)',
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Cash flow restoring soon
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.45 }}>
            {headline}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--muted)',
              marginTop: 4,
              lineHeight: 1.55,
            }}
          >
            {sub}
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--muted)',
            fontSize: 18,
            cursor: 'pointer',
            lineHeight: 1,
            padding: 0,
          }}
        >
          ×
        </button>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          flexWrap: 'wrap',
          marginTop: 2,
        }}
      >
        <PromptCta
          href="/goals"
          label="Plan a goal SIP"
          mono={mono}
          primary
        />
        <PromptCta href="/onboarding?step=4" label="Boost EF" mono={mono} />
        <PromptCta
          href="/tools/recompute"
          label="Run what-if"
          mono={mono}
        />
      </div>
    </div>
  );
}

function PromptCta({
  href,
  label,
  mono,
  primary,
}: {
  href: string;
  label: string;
  mono: boolean;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      style={{
        padding: '5px 11px',
        background: primary ? 'var(--positive)' : 'transparent',
        color: primary ? 'var(--canvas)' : 'var(--positive)',
        border: primary ? 'none' : '1px solid var(--positive)',
        borderRadius: mono ? 0 : 4,
        textDecoration: 'none',
        fontSize: 12,
        fontWeight: 600,
        fontFamily: mono ? 'var(--font-mono)' : undefined,
        letterSpacing: mono ? '0.06em' : undefined,
        textTransform: mono ? 'uppercase' : undefined,
      }}
    >
      {label}
    </Link>
  );
}
