'use client';

/**
 * Two-state toggle on /plan: "model expected hike" vs "lock current income".
 *
 * Writes a cookie via writeHikeModelingClient() and the engine re-runs the
 * simulation with hike modelling on/off. Phases (if configured) appear in
 * the helper line so users see "Y1-2 @ 7%, Y3-6 @ 10%, ..." without leaving /plan.
 *
 * Disabled when user.annual_hike_rate is 0 — there's nothing to model. Still
 * rendered with an explainer so users understand the feature exists.
 */
import { writeHikeModelingClient, type HikeModeling } from '@/lib/hike-modeling';
import { ThemedSegmentedControl } from '@/components/themed/ThemedSegmentedControl';

const OPTIONS: { value: HikeModeling; label: string }[] = [
  { value: 'on', label: 'Include' },
  { value: 'off', label: 'Ignore' },
];

const HELP_ON =
  'Projection grows your income each year on your hike month.';
const HELP_OFF =
  'Projection assumes your income stays flat for the whole horizon.';

export function HikeToggle({
  active,
  hikeRatePct,
  hikeMonthLabel,
  hikePhases,
  variant = 'inline',
}: {
  active: HikeModeling;
  /** "8%" or similar — for display only. Used as the fallback rate
   *  shown when no phases cover the firing year. */
  hikeRatePct: string;
  /** "April" — month the hike fires. */
  hikeMonthLabel: string;
  /** Optional phase configuration from the user's hike_schedule.
   *  When present and toggle is on, we surface a one-liner summary
   *  alongside the toggle so users see "Y1-2 @ 7%, Y3-6 @ 10%, ..."
   *  without leaving /plan. Empty / undefined → scalar-only rate. */
  hikePhases?: [number, number, string][];
  variant?: 'inline' | 'ledger';
}) {
  const hasPhases = (hikePhases ?? []).some(([f, t, r]) => f > 0 && t > f && Number(r) > 0);
  const noHike = !hasPhases && (hikeRatePct === '0%' || hikeRatePct === '');

  // Render phases as a comma-separated list: "Y1-2 @ 7%, Y3-6 @ 10%".
  // year_to is exclusive in the schedule → display as inclusive (to-1).
  const phasesSummary = (hikePhases ?? [])
    .filter(([f, t, r]) => f > 0 && t > f && Number(r) > 0)
    .map(([f, t, r]) => `Y${f}-${t - 1} @ ${Number((Number(r) * 100).toFixed(2))}%`)
    .join(', ');

  const disabledReason = noHike
    ? variant === 'ledger'
      ? 'no pay rise set — add one in setup'
      : "You haven't set a hike rate in setup, so there's nothing to model. Add one to enable."
    : undefined;

  const helper =
    variant === 'ledger'
      ? active === 'on'
        ? phasesSummary
          ? `${phasesSummary} · then ${hikeRatePct} fallback`
          : `${hikeRatePct} every ${hikeMonthLabel}`
        : 'income stays flat'
      : active === 'on'
        ? phasesSummary
          ? `${HELP_ON} Phases: ${phasesSummary}. Years outside any phase use ${hikeRatePct}.`
          : `${HELP_ON} (${hikeRatePct} every ${hikeMonthLabel}.)`
        : HELP_OFF;

  return (
    <ThemedSegmentedControl<HikeModeling>
      variant={variant}
      label="Pay rises"
      options={OPTIONS}
      active={active}
      onPick={writeHikeModelingClient}
      disabledReason={disabledReason}
      helper={helper}
    />
  );
}
