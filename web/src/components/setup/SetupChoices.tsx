'use client';

/** Setup's last step: the choices only the person can make (lib/setup-choices). */
import { LChip as Chip, LChipRow as ChipRow, L_T } from '@/components/ledger/primitives';
import { Term } from '@/components/Term';
import { CHOICE_ERROR, EF_MONTH_CHOICES, EF_SPLIT_CHOICES, missingChoices, type SetupChoices as Choices } from '@/lib/setup-choices';
import { STRATEGIES, STRATEGY_PLAIN, STRATEGY_LABEL, type StrategyName } from '@/lib/strategy';

const ORDER: StrategyName[] = STRATEGIES;

export function SetupChoices({
  value,
  onChange,
  showErrors,
  hasLoans,
  monthlySpend,
  money,
}: {
  value: Choices;
  onChange: (c: Choices) => void;
  showErrors: boolean;
  /** With no loans only the fund is asked. */
  hasLoans: boolean;
  monthlySpend: number;
  money: (v: string) => string;
}) {
  const missing = new Set(showErrors ? missingChoices(value, hasLoans) : []);
  const err = (k: 'ef_months' | 'ef_split' | 'strategy') =>
    missing.has(k) ? <p role="alert" style={{ margin: '4px 0 0', fontSize: 12, color: L_T.negative }}>{CHOICE_ERROR[k]}</p> : null;
  return (
    <section aria-labelledby="choices-h" style={{ border: `1px solid ${L_T.ink}`, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 14, background: L_T.paper }}>
      <div>
        <h3 id="choices-h" style={{ margin: 0, fontSize: 12, letterSpacing: "0.14em" }}>YOUR CALL · CHOICES ONLY YOU CAN MAKE</h3>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: L_T.muted, lineHeight: 1.55 }}>
          The plan won&apos;t pick these for you. Change any of them later on Plan or Profile.
        </p>
      </div>
      <div>
        <ChipRow label="An emergency fund: how many months of spending to keep aside?">
          {EF_MONTH_CHOICES.map((m) => (
            <Chip key={m} on={value.efMonths === m} onClick={() => onChange({ ...value, efMonths: m, efSplit: m === 0 ? null : value.efSplit })}>
              {m === 0 ? 'Not now' : `${m} months${monthlySpend > 0 ? ` · ${money(String(Math.round(m * monthlySpend)))}` : ''}`}
            </Chip>
          ))}
        </ChipRow>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: L_T.muted }}>
          <Term id="emergency_fund">What&apos;s an emergency fund?</Term> Many people keep 3 to 6 months; with a steady job and
          dear debt, some start smaller.
        </p>
        {err('ef_months')}
      </div>
      {hasLoans && (value.efMonths ?? 0) > 0 && (
        <div>
          <ChipRow label="While it fills, how much of your spare cash goes to it?">
            {EF_SPLIT_CHOICES.map((s) => (
              <Chip key={s} on={value.efSplit === s} onClick={() => onChange({ ...value, efSplit: s })}>
                {s === '1.00' ? 'All of it, then the loans' : `${Math.round(Number(s) * 100)}%, the rest to loans`}
              </Chip>
            ))}
          </ChipRow>
          {err('ef_split')}
        </div>
      )}
      {hasLoans && (<div>
        <ChipRow label="Which loan gets your extra money first?">
          {ORDER.map((s) => (
            <Chip key={s} on={value.strategy === s} onClick={() => onChange({ ...value, strategy: s })}>
              {STRATEGY_PLAIN[s]} ({STRATEGY_LABEL[s]})
            </Chip>
          ))}
        </ChipRow>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: L_T.muted }}>
          <Term id="avalanche">Cheapest path</Term> · <Term id="snowball">Smallest first</Term> · <Term id="rules">Your own order</Term> (set it on Profile).
        </p>
        {err('strategy')}
      </div>)}
    </section>
  );
}
