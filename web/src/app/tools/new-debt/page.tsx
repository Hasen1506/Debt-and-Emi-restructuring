import { NewDebtTool } from './tool';
import { LToolPageHeader } from '@/components/ledger/LToolPageHeader';

export default function NewDebtPage() {
  return (
    <LToolPageHeader id="new-debt">
      <NewDebtTool />
    </LToolPageHeader>
  );
}
