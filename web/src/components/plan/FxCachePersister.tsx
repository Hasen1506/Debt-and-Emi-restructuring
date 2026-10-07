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
  // Keyed on the rates' content, not the object: a re-render with the same
  // rates (e.g. when sign-out flips the session to anonymous just before the
  // page unloads) re-stamped the cookie right after sign-out had cleared it,
  // leaving the last user's FX cache in the browser (E2E golden journey).
  const key = JSON.stringify(rates);
  useEffect(() => {
    const parsed = JSON.parse(key) as Record<string, string>;
    if (Object.keys(parsed).length === 0) return;
    saveFxCacheClient(parsed);
  }, [key]);
  return null;
}
