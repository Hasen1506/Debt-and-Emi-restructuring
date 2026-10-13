import { NriPrepayTool } from './tool';
import { LToolPageHeader } from '@/components/ledger/LToolPageHeader';

/** Its own tab title (UX50 C-26 / E-15). */
export const metadata = { title: 'NRI prepay · RightDue' };

export default function NriPrepayPage() {
  return (
    <LToolPageHeader id="nri-prepay">
      <NriPrepayTool />
    </LToolPageHeader>
  );
}
