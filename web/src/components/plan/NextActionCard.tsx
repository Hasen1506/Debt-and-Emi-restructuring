'use client';

/**
 * Next-best-action card — top of /plan. Renders a single recommendation
 * from the rule-ladder, or a celebratory "on track" fallback. One
 * sentence, one action, dismissible.
 *
 * Snooze persists per-archetype in localStorage for 7 days so the user
 * who keeps seeing the same nag can dismiss it without it bouncing back
 * on the next visit. Snooze keyed by archetype, not exact headline,
 * because the headline changes as numbers move but the underlying
 * concern is the same.
 *
 * Reads goals + contributions + lifecycle from localStorage at mount.
 * SSR renders nothing (the placeholder is invisible); the card pops in
 * after hydrate. Acceptable since the rest of /plan is server-rendered
 * and the next-action is purely advisory.
 */

import { useEffect, useState } from 'react';
import type { UserPayload } from '@/lib/api';
import {
  computeNextAction,
  type NextAction,
  type NextActionArchetype,
} from '@/lib/next-action';
import { readGoalsClient } from '@/lib/goals';
import {
  readContributionsClient,
  totalsByGoal,
} from '@/lib/goal-contributions';
import { readLifecycleClient } from '@/lib/lifecycle-events';
import {
  ThemedContainer,
  ThemedLabel,
} from '@/components/themed/Themed';
import type { ThemeName } from '@/lib/theme';

const SNOOZE_KEY = 'finoptima_next_action_snooze';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

type SnoozeMap = Partial<Record<NextActionArchetype, number>>;

function readSnooze(): SnoozeMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw);
    return typeof v === 'object' && v !== null ? (v as SnoozeMap) : {};
  } catch {
    return {};
  }
}

function writeSnooze(next: SnoozeMap) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
}

function isSnoozed(arch: NextActionArchetype, map: SnoozeMap): boolean {
  const until = map[arch];
  if (!until) return false;
  return Date.now() < until;
}

export function NextActionCard({
  user,
  monthlySurplus,
  variant,
}: {
  user: UserPayload;
  monthlySurplus: number;
  variant: ThemeName;
}) {
  const [action, setAction] = useState<NextAction | null>(null);

  useEffect(() => {
    const goals = readGoalsClient();
    const totals = totalsByGoal(readContributionsClient());
    const lifecycle = readLifecycleClient();
    const snooze = readSnooze();
    let next = computeNextAction({
      user,
      goals,
      contributionTotals: totals,
      lifecycleEvents: lifecycle,
      monthlySurplus,
    });
    // Walk the ladder again skipping snoozed archetypes. v1 ladder
    // doesn't surface alternative recommendations beyond the first
    // match, so a snoozed top rule means we drop to the fallback —
    // which is celebratory and always-displayable.
    if (isSnoozed(next.archetype, snooze) && next.archetype !== 'on_track') {
      next = {
        archetype: 'on_track',
        headline: "You're on track.",
        reason: 'Snoozed the current nudge — back to the dashboards.',
        ctaLabel: 'View plan',
        ctaHref: '/plan',
        positive: true,
      };
    }
    setAction(next);
  }, [user, monthlySurplus]);

  if (!action) return null;

  function snooze() {
    if (!action || action.archetype === 'on_track') return;
    const next = { ...readSnooze(), [action.archetype]: Date.now() + SNOOZE_MS };
    writeSnooze(next);
    setAction({
      archetype: 'on_track',
      headline: "You're on track.",
      reason: 'Snoozed for 7 days.',
      ctaLabel: 'View plan',
      ctaHref: '/plan',
      positive: true,
    });
  }

  const isOnTrack = action.archetype === 'on_track';
  const accentColor = isOnTrack ? 'var(--positive)' : 'var(--accent)';
  const upper = variant === 'ledger';

  return (
    <ThemedContainer
      variant={variant}
      style={{
        marginBottom: 16,
        borderLeft: `3px solid ${accentColor}`,
      }}
    >
      <ThemedLabel variant={variant}>
        {upper
          ? isOnTrack
            ? 'ON TRACK'
            : 'NEXT BEST ACTION'
          : isOnTrack
            ? 'On track'
            : 'Next best action'}
      </ThemedLabel>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          marginTop: 6,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: variant === 'editorial' ? 22 : 16,
              fontWeight: variant === 'editorial' ? 400 : 600,
              fontFamily:
                variant === 'editorial'
                  ? 'var(--font-display)'
                  : variant === 'ledger'
                    ? 'var(--font-mono)'
                    : 'var(--font-sans)',
              lineHeight: 1.3,
              color: 'var(--ink)',
            }}
          >
            {action.headline}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--muted)',
              marginTop: 4,
              lineHeight: 1.55,
              fontStyle: variant === 'editorial' ? 'italic' : 'normal',
            }}
          >
            {action.reason}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          <a
            href={action.ctaHref}
            style={{
              padding: '6px 12px',
              background: accentColor,
              color: 'var(--canvas)',
              fontSize: 12,
              textDecoration: 'none',
              borderRadius: variant === 'ledger' ? 0 : 4,
              fontFamily:
                variant === 'ledger' ? 'var(--font-mono)' : 'var(--font-sans)',
              whiteSpace: 'nowrap',
              letterSpacing: variant === 'ledger' ? '0.06em' : 'normal',
            }}
          >
            {upper ? `[${action.ctaLabel.toUpperCase()}]` : action.ctaLabel}
          </a>
          {!isOnTrack && action.secondaryLabel && (
            <button
              type="button"
              onClick={snooze}
              style={{
                padding: '6px 10px',
                background: 'transparent',
                color: 'var(--muted)',
                border: '1px solid var(--border)',
                borderRadius: variant === 'ledger' ? 0 : 4,
                fontSize: 11,
                cursor: 'pointer',
                fontFamily:
                  variant === 'ledger' ? 'var(--font-mono)' : 'var(--font-sans)',
                whiteSpace: 'nowrap',
              }}
            >
              {action.secondaryLabel}
            </button>
          )}
        </div>
      </div>
    </ThemedContainer>
  );
}
