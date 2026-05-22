'use client';

/**
 * Two-state toggle on /plan: model expense inflation, or treat expenses
 * as flat across the horizon?
 *
 * Writes a cookie via writeInflationModelingClient() and the engine compounds
 * user.inflation_rate into the surplus computation each month when ON.
 *
 * Disabled when user.inflation_rate is zero — no inflation configured, nothing
 * to compound. Still rendered (with an explainer) so users understand the
 * feature exists.
 */
import {
  writeInflationModelingClient,
  type InflationModeling,
} from '@/lib/inflation-modeling';
import { ThemedSegmentedControl } from '@/components/themed/ThemedSegmentedControl';

const OPTIONS: { value: InflationModeling; label: string }[] = [
  { value: 'on', label: 'Inflate expenses' },
  { value: 'off', label: 'Flat expenses' },
];

const HELP_ON =
  'Your monthly expenses grow at the country-default CPI rate each year. Surplus shrinks over time → debt-free month pushes out.';
const HELP_OFF =
  'Expenses stay flat for the entire horizon. Realistic for short-tenure plans, optimistic for 10-20yr home loans.';

export function InflationToggle({
  active,
  inflationRatePct,
  variant = 'inline',
}: {
  active: InflationModeling;
  /** "5.5%" — for display only. */
  inflationRatePct: string;
  variant?: 'inline' | 'ledger';
}) {
  const noInflation = inflationRatePct === '0%' || inflationRatePct === '';

  const disabledReason = noInflation
    ? variant === 'ledger'
      ? 'no inflation set — adjust in setup to enable'
      : 'Inflation rate is 0 in setup. Set a value to model expense growth.'
    : undefined;

  const helper =
    variant === 'ledger'
      ? active === 'on'
        ? `expenses +${inflationRatePct}/yr`
        : 'flat expenses across horizon'
      : active === 'on'
        ? `${HELP_ON} (${inflationRatePct} per year.)`
        : HELP_OFF;

  return (
    <ThemedSegmentedControl<InflationModeling>
      variant={variant}
      label="Inflation"
      options={OPTIONS}
      active={active}
      onPick={writeInflationModelingClient}
      disabledReason={disabledReason}
      helper={helper}
    />
  );
}
