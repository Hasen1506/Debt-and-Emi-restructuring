'use client';

/**
 * Two-state toggle on /plan: model FX drift for non-residence-currency
 * loans, or hold spot rate flat across the horizon?
 *
 * Visible only for hybrid users (≥ 2 currencies in play). Single-currency
 * users see nothing — parent component gates rendering.
 *
 * When ON, the engine compounds the per-currency drift rate into the FX
 * conversion each month. For an NRI-US user with an INR home loan, a
 * +2.5%/yr INR drift means EMIs paid in INR cost fewer USD each year as
 * the rupee depreciates.
 */
import { writeFxDriftClient, type FxDriftSetting } from '@/lib/fx-drift';
import { ThemedSegmentedControl } from '@/components/themed/ThemedSegmentedControl';

const OPTIONS: { value: FxDriftSetting; label: string }[] = [
  { value: 'on', label: 'Include' },
  { value: 'off', label: 'Ignore' },
];

const HELP_ON =
  "Foreign-currency loan EMIs are converted using a drift-adjusted FX rate that compounds yearly — captures the long-run inflation differential view.";
const HELP_OFF =
  "Foreign-currency loan EMIs use today's spot rate for the entire horizon. Simpler, but understates the FX dimension for multi-year loans.";

export function FxDriftToggle({
  active,
  driftLabel,
  variant = 'inline',
}: {
  active: FxDriftSetting;
  /** Pretty label like "INR +2.5%/yr" for the helper line. */
  driftLabel: string;
  variant?: 'inline' | 'ledger';
}) {
  const helper =
    variant === 'ledger'
      ? active === 'on'
        ? driftLabel
        : 'spot FX held flat across horizon'
      : active === 'on'
        ? `${HELP_ON} (${driftLabel}.)`
        : HELP_OFF;

  return (
    <ThemedSegmentedControl<FxDriftSetting>
      variant={variant}
      label="Rupee weakening"
      options={OPTIONS}
      active={active}
      onPick={writeFxDriftClient}
      helper={helper}
    />
  );
}
