'use client';

/**
 * The exchange rate behind a foreign loan, with its date and a Refresh
 * button (roadmap PR B). Shown on Home above the loans. A rate older than a
 * week, or one that failed to refresh, is a warning that asks for a rate in
 * Profile; there is never a silent 1:1.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UserPayload } from '@/lib/api';
import { userDefaultCurrency } from '@/lib/currency';
import { foreignCurrencies, fxAsOfLabel, fxIsStale } from '@/lib/fx-refresh';
import { LBracket, L_T } from '@/components/ledger/primitives';
import { refreshProfileFx } from './FxAutoRefresh';

export function FxRateLine({ user, nowMs }: { user: UserPayload; nowMs: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string[]>([]);
  const ccys = foreignCurrencies(user);
  if (ccys.length === 0) return null;
  const own = userDefaultCurrency(user.country);
  const refresh = async () => {
    setBusy(true);
    const res = await refreshProfileFx(ccys);
    setFailed(res.failed);
    setBusy(false);
    if (res.refreshed.length > 0) router.refresh();
  };
  return (
    <div role="note" aria-label="Exchange rates" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'baseline', fontSize: 'var(--fs-small)', color: L_T.muted, margin: '0 0 10px' }}>
      {ccys.map((c) => {
        const rate = user.fx_to_user_currency?.[c];
        const meta = user.fx_meta?.[c];
        const warn = failed.includes(c) || fxIsStale(meta, nowMs);
        return (
          <span key={c} style={{ color: warn ? L_T.negative : L_T.muted }}>
            {Number(rate) > 0 ? `1 ${c} = ${Number(rate).toPrecision(4)} ${own} · ${fxAsOfLabel(meta)}` : `No ${c} rate yet`}
            {failed.includes(c) ? ' · couldn’t refresh, using this rate until you enter one in Profile' : warn ? ' · may be out of date' : ''}
          </span>
        );
      })}
      <LBracket onClick={refresh} disabled={busy} label={busy ? 'Refreshing exchange rates' : 'Refresh rate: update the exchange rates'}>{busy ? 'REFRESHING…' : 'REFRESH RATE'}</LBracket>
      {failed.length > 0 && <LBracket href="/profile?step=loans">ENTER A RATE →</LBracket>}
    </div>
  );
}
