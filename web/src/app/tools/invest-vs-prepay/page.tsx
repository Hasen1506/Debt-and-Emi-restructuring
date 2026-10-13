import { InvestVsPrepayDeepTool } from './tool';
import { LToolPageHeader } from '@/components/ledger/LToolPageHeader';
import { LNote } from '@/components/ledger/LToolSteps';
import { INVEST_VS_PREPAY_DISCLAIMER } from '@/lib/disclaimers';

/** Its own tab title (UX50 C-26 / E-15). */
export const metadata = { title: 'Invest or prepay · RightDue' };

export default function InvestVsPrepayPage() {
  return (
    <LToolPageHeader id="invest-vs-prepay">
      <InvestVsPrepayDeepTool />
      <LNote>{INVEST_VS_PREPAY_DISCLAIMER}</LNote>
    </LToolPageHeader>
  );
}
