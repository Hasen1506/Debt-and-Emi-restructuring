'use client';

/** UX50 B-11: Home's one-line "this month" instruction (the words come from
 *  lib/home-this-month, worked out on the server). */
import { LBracket, L_T, lStrip } from '@/components/ledger/primitives';
import type { ThisMonthLine } from '@/lib/home-this-month';

export function HomeThisMonth({ line }: { line: ThisMonthLine }) {
  return (
    <section
      aria-label="This month"
      data-testid="home-this-month"
      style={{ padding: '12px 14px', background: L_T.paper, border: `1px solid ${L_T.ruleSoft}`, ...lStrip(line.tone === 'short' ? 'negative' : 'accent') }}
    >
      <div style={{ fontSize: 11, letterSpacing: '0.12em', color: L_T.muted, marginBottom: 4 }}>THIS MONTH</div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
        {line.text} <LBracket href="#home-pay">{line.link}</LBracket>
      </p>
    </section>
  );
}
