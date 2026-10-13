import { NewDebtTool } from './tool';
import { PurchaseTool } from '../purchase/tool';
import { LToolPageHeader } from '@/components/ledger/LToolPageHeader';
import { LBracket } from '@/components/ledger/primitives';
import { newDebtMode } from '@/lib/new-debt-mode';

/** Its own tab title (UX50 C-26 / E-15). */
export const metadata = { title: 'New debt · RightDue' };

/**
 * New debt check, with Big purchase merged in (roadmap PR I): one place
 * to check new debt before signing. "A loan or EMI offer" is the loan the
 * bank is offering; "A big purchase" is a home or car you plan to buy, with
 * its down payment and what it does to your goals. /tools/purchase now
 * redirects here with ?mode=purchase.
 */
export default async function NewDebtPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const mode = newDebtMode((await searchParams)?.mode);
  return (
    <LToolPageHeader id="new-debt">
      <nav aria-label="What are you checking?" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '0 0 16px' }}>
        <LBracket href="/tools/new-debt" active={mode === 'offer'} current={mode === 'offer'}>A LOAN OR EMI OFFER</LBracket>
        <LBracket href="/tools/new-debt?mode=purchase" active={mode === 'purchase'} current={mode === 'purchase'}>A BIG PURCHASE (HOME, CAR)</LBracket>
      </nav>
      {mode === 'purchase' ? <PurchaseTool /> : <NewDebtTool />}
    </LToolPageHeader>
  );
}
