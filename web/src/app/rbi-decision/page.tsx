import type { Metadata } from 'next';
import { LShell, L_T } from '@/components/ledger/primitives';
import { RbiDecisionTool } from './tool';

// Audit 80+ A19: a public, no-sign-in page for each RBI decision, running
// the same reset arithmetic as Loan Check (engine/rate_reset.py) and
// linking to the plan. Update cadence: docs/LOAN-CHECK-HIKE-CYCLE.md.
export const metadata: Metadata = {
  title: 'RBI decision: what happens to your EMI · RightDue',
  description:
    "What the RBI's latest repo-rate decision does to your home-loan EMI or tenure, the choice your bank must offer, and what the next meeting could mean. Free, no sign-in.",
  alternates: { canonical: '/rbi-decision' },
  openGraph: {
    title: 'RBI decision: what happens to your EMI',
    description: 'Your new EMI or tenure after the RBI move, worked out on your own loan. Free, no sign-in.',
    url: '/rbi-decision',
    images: [{ url: '/og-loan-check.png', width: 1200, height: 630 }],
  },
};

export default function RbiDecisionPage() {
  return (
    <LShell>
      <header style={{ marginBottom: 18, maxWidth: 820 }}>
        <div style={{ fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', letterSpacing: '0.18em', color: L_T.muted, marginBottom: 10 }}>
          RBI DECISION · NO SIGN-IN
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, textTransform: 'uppercase', lineHeight: 1.25 }}>
          RBI decision: what happens to your EMI
        </h1>
      </header>
      <RbiDecisionTool />
    </LShell>
  );
}
