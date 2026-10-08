import { InvestVsPrepayDeepTool } from './tool';
import { LToolPageHeader } from '@/components/ledger/LToolPageHeader';
import { LNote } from '@/components/ledger/LToolSteps';
import { INVEST_VS_PREPAY_DISCLAIMER } from '@/lib/disclaimers';

export default function InvestVsPrepayPage() {
  return (
    <LToolPageHeader id="invest-vs-prepay">
      <InvestVsPrepayDeepTool />
      <LNote>{INVEST_VS_PREPAY_DISCLAIMER}</LNote>
    </LToolPageHeader>
  );
}
