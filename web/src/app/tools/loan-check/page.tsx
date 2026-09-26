import { LoanCheckTool } from './tool';
import { LToolPageHeader } from '@/components/ledger/LToolPageHeader';

export default function LoanCheckPage() {
  return (
    <LToolPageHeader id="loan-check">
      <LoanCheckTool />
    </LToolPageHeader>
  );
}
