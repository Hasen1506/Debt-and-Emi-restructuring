'use client';

/**
 * Two-state toggle on /plan: "auto-reinvest tax savings" vs "off".
 *
 * Writes a cookie via writeTaxReinvestClient(); engine routes each year's
 * projected saving to the highest-effective-APR active loan at the
 * post-ITR-filing month.
 *
 * Disabled when projected savings sum to zero — e.g. India new regime with no
 * education loan, or US user without an eligible home / education loan, or
 * marginal_rate = 0. Still rendered (greyed) with an explainer.
 */
import {
  writeTaxReinvestClient,
  type TaxReinvestSetting,
} from '@/lib/tax-reinvest';
import { ThemedSegmentedControl } from '@/components/themed/ThemedSegmentedControl';

const OPTIONS: { value: TaxReinvestSetting; label: string }[] = [
  { value: 'on', label: 'Auto-reinvest' },
  { value: 'off', label: 'Off' },
];

const HELP_ON =
  'Each year, projected tax savings on deductible interest are routed back to your highest-effective-APR debt.';
const HELP_OFF =
  'No reinvest applied. Tax savings (if any) stay with you to spend freely.';

export function TaxReinvestToggle({
  active,
  totalProjectedSaving,
  variant = 'inline',
}: {
  active: TaxReinvestSetting;
  /** Sum of projected tax savings across the horizon, in user-default
   *  currency. Used to render the "₹2.4L over 20 years" label next to the
   *  toggle. Zero/empty disables the toggle. */
  totalProjectedSaving: string;
  variant?: 'inline' | 'ledger';
}) {
  const noSavings =
    totalProjectedSaving === '' || Number(totalProjectedSaving) <= 0;

  const disabledReason = noSavings
    ? variant === 'ledger'
      ? 'no eligible deductions — switch regime or add a deductible loan'
      : 'No eligible deductions projected. India users: switch to old tax regime in setup to unlock Sec 24/80E. US users: only home + student loan interest qualify.'
    : undefined;

  const helper =
    variant === 'ledger'
      ? active === 'on'
        ? `~${totalProjectedSaving} over horizon → highest APR debt`
        : `~${totalProjectedSaving} unrouted — toggle to apply`
      : active === 'on'
        ? `${HELP_ON} (~${totalProjectedSaving} over horizon.)`
        : `${HELP_OFF} Projected reinvest if enabled: ~${totalProjectedSaving}.`;

  return (
    <ThemedSegmentedControl<TaxReinvestSetting>
      variant={variant}
      label="Tax reinvest"
      options={OPTIONS}
      active={active}
      onPick={writeTaxReinvestClient}
      disabledReason={disabledReason}
      helper={helper}
    />
  );
}
