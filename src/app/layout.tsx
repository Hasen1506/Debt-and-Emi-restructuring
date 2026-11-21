import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, DM_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { RightDueProvider } from '@/lib/store';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-jakarta',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-dm-sans',
  display: 'swap',
});

const ibmMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'RightDue — Borrower Rights, Rate Recovery & Debt Command Center',
  description:
    'Audit hidden bank overcharges, parse bank SMS on-device, expose true loan APR with GST, verify bank RM or AI advice, and generate statutory escalation letters for India and the US — with zero lender commissions.',
  openGraph: {
    title: 'RightDue — Borrower Rights & Debt Command Center',
    description:
      'Audit hidden bank overcharges, parse bank SMS on-device, and generate statutory RBI & US RESPA escalation letters with zero lender commissions.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#F8FAFC',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} ${dmSans.variable} ${ibmMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen overflow-x-hidden">
        <RightDueProvider>{children}</RightDueProvider>
      </body>
    </html>
  );
}
