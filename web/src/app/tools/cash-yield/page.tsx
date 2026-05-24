import { CashYieldTool } from './tool';
import { LToolPageHeader } from '@/components/ledger/LToolPageHeader';

export default function CashYieldPage() {
  return (
    <LToolPageHeader id="cash-yield">
      <CashYieldTool />
    </LToolPageHeader>
  );
}
