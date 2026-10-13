import { LoanCheckTool } from './tool';
import { LToolPageHeader } from '@/components/ledger/LToolPageHeader';
import type { Metadata } from 'next';

// UX50 E-14: its own share card, the best growth loop the site has.
// Its own tab title (UX50 C-26 / E-15).
export const metadata: Metadata = {
  title: 'Loan check · RightDue',
  alternates: { canonical: '/tools/loan-check' },
  openGraph: {
    title: 'Is your bank passing on RBI rate cuts? Check in 2 minutes',
    description: 'Your home-loan rate against every RBI repo move since you borrowed. Free, no sign-in.',
    url: '/tools/loan-check',
    images: [{ url: '/og-loan-check.png', width: 1200, height: 630 }],
  },
  twitter: { card: 'summary_large_image', images: ['/og-loan-check.png'] },
};

export default function LoanCheckPage() {
  return (
    <LToolPageHeader id="loan-check">
      <LoanCheckTool />
    </LToolPageHeader>
  );
}
