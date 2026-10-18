'use client';
/**
 * UX50 E-06 / E-07: one footer on every app page. The "estimates, not
 * advice" line wherever a figure can appear, plus privacy, terms, a
 * "Report a problem" mailto and the contact address. Hidden in print.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { L_T } from '@/components/ledger/primitives';
import { reportProblemHref, SUPPORT_EMAIL } from '@/lib/report-problem';

export function SiteFooter({ version }: { version?: string | null }) {
  const path = usePathname() || '/';
  const link = { color: L_T.muted, textDecoration: 'underline' } as const;
  return (
    <footer
      className="rd-site-footer"
      aria-label="About RightDue"
      style={{ borderTop: `1px solid ${L_T.ruleSoft}`, padding: '14px clamp(16px, 4vw, 32px) 22px', fontSize: 11, lineHeight: 1.6, color: L_T.muted, background: L_T.bg }}
    >
      <style>{`@media print{.rd-site-footer{display:none !important}}`}</style>
      <p style={{ margin: '0 0 6px', maxWidth: 760 }}>
        RightDue&rsquo;s figures are estimates from the numbers you enter, not financial, tax or legal advice. Check
        important numbers with your lender. RightDue is not a lender and takes no money from lenders.
      </p>
      <p style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
        <Link href="/privacy" style={link}>Privacy</Link>
        <Link href="/terms" style={link}>Terms</Link>
        <a href={reportProblemHref(path, version)} style={link} data-testid="report-problem">Report a problem</a>
        <a href={`mailto:${SUPPORT_EMAIL}`} style={link}>{SUPPORT_EMAIL}</a>
        <span>© 2026 RightDue</span>
      </p>
    </footer>
  );
}
