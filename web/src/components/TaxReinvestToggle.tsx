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
  { value: 'on', label: 'Pay debt' },
  { value: 'off', label: 'Keep' },
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
  // The figure arrives formatted ("₹12,400"), so read the digits.
  const noSavings = !(Number(totalProjectedSaving.replace(/[^\d.]/g, '')) > 0);

  const disabledReason = noSavings
    ? variant === 'ledger'
      ? 'no loan tax deductions for your setup'
      : 'No eligible deductions projected for your tax setup — only home / education-loan interest qualifies, subject to regime and country rules.'
    : undefined;

  const helper =
    variant === 'ledger'
      ? active === 'on'
        ? `~${totalProjectedSaving} over the plan goes to the dearest debt`
        : `~${totalProjectedSaving} over the plan stays as cash`
      : active === 'on'
        ? `${HELP_ON} (~${totalProjectedSaving} over horizon.)`
        : `${HELP_OFF} Projected reinvest if enabled: ~${totalProjectedSaving}.`;

  return (
    <ThemedSegmentedControl<TaxReinvestSetting>
      variant={variant}
      label="Tax refunds"
      options={OPTIONS}
      active={active}
      onPick={writeTaxReinvestClient}
      disabledReason={disabledReason}
      helper={helper}
    />
  );
}
