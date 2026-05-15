/**
 * Editorial Insights — "The Archive".
 *
 * Now a user-recorded activity ledger. The hardcoded DISPATCHES of the
 * pre-Bucket-C era are gone; what remains is a dispatch-styled rendering
 * of real payment events with a serif body and an italic penalty line
 * for partials/misses.
 */

import { ActivityLedger } from './ActivityLedger';
import type { StoredProfile } from '@/lib/user-store';

export function EditorialInsights({ profile }: { profile: StoredProfile }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 240px',
        gap: 48,
        paddingTop: 16,
      }}
    >
      <article style={{ maxWidth: 720 }}>
        <div
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 11,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            color: 'var(--soft)',
            marginBottom: 12,
          }}
        >
          The archive · in your own hand
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 400,
            fontSize: 44,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            margin: 0,
          }}
        >
          What you paid,
          <br />
          <em style={{ fontStyle: 'italic', color: 'var(--accent)' }}>
            and what it would have cost.
          </em>
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 17,
            lineHeight: 1.65,
            marginTop: 22,
            maxWidth: 580,
            color: 'var(--muted)',
            fontStyle: 'italic',
          }}
        >
          Record the months as they happen. Where you fell short, we draw
          on the bank&apos;s own Schedule of Charges to estimate what the
          shortfall would have cost — so an honest record stays honestly
          priced.
        </p>

        <div
          style={{
            marginTop: 40,
            paddingTop: 24,
            borderTop: '1px solid var(--border)',
          }}
        >
          <ActivityLedger user={profile.user} variant="editorial" />
        </div>
      </article>

      <aside
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 11,
          color: 'var(--soft)',
          lineHeight: 1.6,
          paddingTop: 36,
        }}
      >
        <div
          style={{
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            marginBottom: 14,
            fontSize: 10,
          }}
        >
          On the record
        </div>
        <div
          style={{
            borderLeft: '2px solid var(--border)',
            paddingLeft: 12,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 13,
              color: 'var(--ink)',
              fontStyle: 'italic',
              marginBottom: 6,
            }}
          >
            Stored locally
          </div>
          <div style={{ color: 'var(--ink)', fontSize: 12, lineHeight: 1.55 }}>
            Your entries never leave this browser. Same model as the rest of
            your profile.
          </div>
        </div>
        <div
          style={{
            borderLeft: '2px solid var(--border)',
            paddingLeft: 12,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 13,
              color: 'var(--ink)',
              fontStyle: 'italic',
              marginBottom: 6,
            }}
          >
            Penalty source
          </div>
          <div style={{ color: 'var(--ink)', fontSize: 12, lineHeight: 1.55 }}>
            Each bank&apos;s published Schedule of Charges when we have it,
            with country medians ({profile.user.country === 'IN' ? '₹500 flat + 2–3 %/mo' : '$25–30 flat + ~5 %/yr'}) as a careful fallback.
          </div>
        </div>
      </aside>
    </div>
  );
}
