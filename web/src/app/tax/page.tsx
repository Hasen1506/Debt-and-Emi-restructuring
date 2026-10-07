import { loadProfileServer } from '@/lib/user-store';
import { LBracket, LShell, L_T } from '@/components/ledger/primitives';

export const dynamic = 'force-dynamic';

/**
 * /tax: the tax settings the plan uses, in one place. It used to be a bare
 * 404 (live QA, 7 Oct), which also rendered without the signed-in header
 * controls. The page is a summary; changes happen in Profile.
 */
export default async function TaxPage() {
  const profile = await loadProfileServer();
  const u = profile.user;
  const isIN = u.country === 'IN';
  const rate = Number(profile.marginalRate || 0);
  const rows: Array<[string, string]> = [
    ['Country', isIN ? 'India (₹)' : 'USA ($)'],
    isIN
      ? ['Tax regime', u.tax_regime === 'old' ? 'Old regime' : 'New regime (s.115BAC)']
      : ['Filing status', ({ single: 'Single', mfj: 'Married filing jointly', hoh: 'Head of household' } as Record<string, string>)[u.filing_status ?? 'single'] ?? 'Single'],
    ['Marginal rate the plan uses', `${(rate * 100).toFixed(1)}%${profile.isLive ? '' : ' (no profile yet)'}`],
    ...(!isIN && u.state_marginal_rate ? [['State rate', `${(Number(u.state_marginal_rate) * 100).toFixed(1)}%`] as [string, string]] : []),
  ];
  return (
    <LShell>
      <div style={{ display: 'grid', gap: 16, maxWidth: 720 }}>
        <h1 style={{ margin: 0, fontSize: 20, letterSpacing: '0.08em' }}>TAX</h1>
        <p style={{ margin: 0, color: L_T.muted, fontSize: 13, lineHeight: 1.6 }}>
          The plan uses these to work out each loan&apos;s cost after tax ({isIN ? 'sections 24(b) and 80E' : 'mortgage and student-loan interest deductions'}) and
          whether prepaying beats investing after tax.
        </p>
        <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '8px 16px', margin: 0, fontSize: 13 }}>
          {rows.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <dt style={{ color: L_T.muted }}>{k}</dt>
              <dd style={{ margin: 0 }}>{v}</dd>
            </div>
          ))}
        </dl>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <LBracket href="/profile?step=income">CHANGE TAX DETAILS</LBracket>
          <LBracket href="/plan">SEE THE PLAN</LBracket>
        </div>
      </div>
    </LShell>
  );
}
