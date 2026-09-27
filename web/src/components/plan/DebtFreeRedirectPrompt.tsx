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
import {
  ThemedContainer,
  ThemedDetail,
  ThemedHeadline,
  ThemedLabel,
} from '@/components/themed/Themed';
import type { PlanData } from './PlanData';
import { loanToUser } from '@/lib/currency';

const DISMISS_KEY = 'finoptima_debtfree_prompt_dismissed';

export function DebtFreeRedirectPrompt({
  plan,
}: {
  plan: PlanData;
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

  // Month 1 is this month, so the last EMI is debtFreeMonth − 1 months away.
  const monthsAway = plan.debtFreeMonth - 1;
  // Far-future doesn't need this nudge — only show inside the 12-month band.
  if (monthsAway > 12) return null;

  // In the user's currency: an NRI's ₹20,000 EMI frees about $240, not $20,000.
  const freedMonthlyEmi = plan.user.loans
    .filter((l) => Number(l.outstanding || 0) > 0)
    .reduce(
      (s, l) => s + (loanToUser(Number(l.scheduled_emi || 0), l, plan.user.country, plan.fxRatesUsed) ?? 0),
      0,
    );
  if (freedMonthlyEmi <= 0) return null;

  const dateLabel = monthIndexToCountryLabel(
    plan.debtFreeMonth,
    plan.user.country,
  );
  const freedAmountLabel = formatCurrency(
    String(Math.round(freedMonthlyEmi)),
    plan.displayCurrency,
  );

  const when = monthsAway === 0 ? 'This month' : `In ${monthsAway} ${monthsAway === 1 ? 'month' : 'months'}`;
  const headline = `${when} (${dateLabel}), your last EMI clears. ${freedAmountLabel}/mo of cash flow comes back.`;
  const sub =
    "Pre-decide where it goes now — habits set on the freed-cash moment tend to stick.";

  return (
    <ThemedContainer
      tone="positive"
      style={{
        margin: '10px 0 14px',
        background: 'var(--soft-bg, rgba(0, 150, 80, 0.06))',
        border: '1px solid var(--positive)',
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
          <ThemedLabel tone="positive">
            {'CASH FLOW RESTORING SOON'}
          </ThemedLabel>
          <ThemedHeadline>{headline}</ThemedHeadline>
          <ThemedDetail>{sub}</ThemedDetail>
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
          marginTop: 10,
        }}
      >
        <PromptCta href="/goals" label="Plan a goal SIP" primary />
        <PromptCta href="/onboarding?step=4" label="Boost EF" />
        <PromptCta href="/plan#what-if" label="Run what-if" />
      </div>
    </ThemedContainer>
  );
}

function PromptCta({
  href,
  label,
  primary,
}: {
  href: string;
  label: string;
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
        borderRadius: 0,
        textDecoration: 'none',
        fontSize: 12,
        fontWeight: 600,
        fontFamily: 'var(--font-mono)',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </Link>
  );
}
