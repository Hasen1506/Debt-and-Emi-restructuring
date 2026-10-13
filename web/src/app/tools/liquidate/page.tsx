import { LiquidateTool } from './tool';
import { LToolPageHeader } from '@/components/ledger/LToolPageHeader';

/** Its own tab title (UX50 C-26 / E-15). */
export const metadata = { title: 'Sell to repay · RightDue' };

export default function LiquidatePage() {
  return (
    <LToolPageHeader id="liquidate">
      <LiquidateTool />
    </LToolPageHeader>
  );
}
