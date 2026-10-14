'use client';

/**
 * Plan's RISING COSTS chip, the rate: the central bank's latest forecast
 * by default, said with who made it and when, or the user's own. Their
 * own rent, fees and bills may rise faster or slower than the average.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { formatAsOf } from '@/lib/as-of';
import {
  INFLATION_FORECAST,
  normalizeInflationRate,
  writeInflationModelingClient,
  writeInflationRateClient,
  type InflationModeling,
} from '@/lib/inflation-modeling';
import { Field } from '@/components/ToolPrimitives';
import { LBracket, LChip, L_T } from '@/components/ledger/primitives';

const pct = (v: string) => `${(Number(v) * 100).toFixed(1)}%`;

export function InflationRateControl({
  country,
  own,
  active,
}: {
  country: 'IN' | 'US';
  /** '' = the forecast. */
  own: string;
  /** Whether the plan includes rising costs at all. */
  active: InflationModeling;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const f = INFLATION_FORECAST[country];
  const [mode, setMode] = useState<'forecast' | 'own'>(own ? 'own' : 'forecast');
  const [value, setValue] = useState(own ? (Number(own) * 100).toFixed(1) : '');
  const [error, setError] = useState<string | null>(null);

  function save(next: string) {
    writeInflationRateClient(next);
    startTransition(() => router.refresh());
  }

  function saveOwn() {
    const v = normalizeInflationRate(value.trim() === '' ? '' : String(Number(value) / 100));
    if (!v) {
      setError('Type a yearly rate from 0 to 25, for example 6.');
      return;
    }
    setError(null);
    // Setting a rate means using it: a rate on an ignored setting changed nothing.
    if (active === 'off') writeInflationModelingClient('on');
    save(v);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
      <div role="group" aria-label="How fast prices rise" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <LChip
          on={mode === 'forecast'}
          onClick={() => {
            setMode('forecast');
            setError(null);
            if (own) save('');
          }}
        >
          {f.who}&apos;s forecast · {pct(f.rate)}
        </LChip>
        <LChip on={mode === 'own'} onClick={() => setMode('own')}>
          Your own rate
        </LChip>
      </div>
      {mode === 'own' && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px', maxWidth: 200 }}>
            <Field
              label="Prices rise, % a year"
              value={value}
              onChange={(v) => {
                setValue(v);
                setError(null);
              }}
              placeholder={(Number(f.rate) * 100).toFixed(1)}
              error={error}
            />
          </div>
          <span style={{ paddingBottom: 8 }}>
            <LBracket active onClick={saveOwn}>
              {pending ? 'WORKING IT OUT…' : 'SAVE'}
            </LBracket>
          </span>
        </div>
      )}
      <p style={{ margin: 0, fontSize: 'var(--fs-dense)', color: L_T.muted, lineHeight: 1.6 }}>
        {pct(f.rate)} is {f.who}&apos;s {f.what}, published {formatAsOf(f.asOf)}. It is an average across
        the country; your own rent, school fees and bills may rise faster or slower.
        {active === 'off'
          ? ' The plan ignores rising costs now; choose Include above to use a rate.'
          : own
            ? ` The plan is using your ${pct(own)}.`
            : ''}
      </p>
    </div>
  );
}
