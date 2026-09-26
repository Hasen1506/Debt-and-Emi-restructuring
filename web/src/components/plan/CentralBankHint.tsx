'use client';

/**
 * Central-bank decision hint card — surfaces "MPC/FOMC decision in N days"
 * when the user has a floating-rate loan and the next central-bank
 * meeting is within the 14-day pending window. Encourages "hold off on
 * the prepay/refi until after the meeting" thinking.
 *
 * Data: pulled from /api/rates/central at mount, cached for the duration
 * of the page render. Hidden cleanly when:
 *   • The user has no floating-rate loans for the matching country
 *   • The next meeting is more than 14 days out
 *   • The rates endpoint is unreachable
 */

import { useEffect, useState } from 'react';
import { api, type CentralRatesResponse, type Country } from '@/lib/api';
import { formatAsOf } from '@/lib/as-of';

const HINT_WINDOW_DAYS = 14;

export function CentralBankHint({ country, hasFloating }: { country: Country; hasFloating: boolean }) {
  const [data, setData] = useState<CentralRatesResponse | null>(null);

  useEffect(() => {
    if (!hasFloating) return;
    let cancelled = false;
    api
      .centralRates()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch(() => {
        /* swallow — hint card just stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, [hasFloating]);

  if (!hasFloating || !data) return null;
  const slice = data[country];
  if (!slice || slice.days_until_next == null || slice.next_meeting_date == null) {
    return null;
  }
  if (slice.days_until_next > HINT_WINDOW_DAYS || slice.days_until_next < 0) {
    return null;
  }

  const bankName = country === 'IN' ? 'RBI MPC' : 'Fed FOMC';
  const rateLabel = country === 'IN' ? 'repo rate' : 'fed funds';
  const currentRatePct = `${(Number(slice.current_rate) * 100).toFixed(2)}%`;
  const dateLabel = new Date(slice.next_meeting_date).toLocaleDateString(
    undefined,
    { day: 'numeric', month: 'long' },
  );

  return (
    <div
      style={{
        padding: '12px 14px',
        background: 'var(--card)',
        border: '1px solid var(--accent)',
        borderRadius: 6,
        fontSize: 13,
        lineHeight: 1.55,
        margin: '12px 0',
      }}
    >
      <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: 4 }}>
        {bankName} decision in {slice.days_until_next} day
        {slice.days_until_next === 1 ? '' : 's'} — {dateLabel}
      </div>
      <div className="muted" style={{ fontSize: 12 }}>
        You have at least one floating-rate loan whose price tracks the {rateLabel}.
        Current setting: {currentRatePct} (as of {formatAsOf(slice.as_of)}). If you&apos;re planning a refi or large
        prepay this week, holding off until after the meeting may give you a
        cleaner read on next reset&apos;s direction.
      </div>
    </div>
  );
}
