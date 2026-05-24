import { InvestVsPrepayDeepTool } from './tool';
import { LToolPageHeader } from '@/components/ledger/LToolPageHeader';

export default function InvestVsPrepayPage() {
  return (
    <LToolPageHeader id="invest-vs-prepay">
      <InvestVsPrepayDeepTool />
    </LToolPageHeader>
  );
}
