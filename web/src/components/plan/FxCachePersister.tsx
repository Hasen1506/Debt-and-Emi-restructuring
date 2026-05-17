'use client';

/**
 * Side-effect-only component that round-trips FX rates the server fetched
 * back into the client cookie cache.
 *
 * Server components can't set cookies during render, so the FX-rate cache
 * has to be written client-side. Plan-page server code reads the cache
 * (skipping the network when fresh) and passes whatever rates it used
 * down through PlanData; this component re-stamps the cookie with the
 * current timestamp so subsequent /plan loads stay within the TTL.
 *
 * Renders null — purely a side-effect on mount.
 */

import { useEffect } from 'react';
import { saveFxCacheClient } from '@/lib/user-store';

export function FxCachePersister({
  rates,
}: {
  rates: Record<string, string>;
}) {
  useEffect(() => {
    if (Object.keys(rates).length === 0) return;
    saveFxCacheClient(rates);
  }, [rates]);
  return null;
}
