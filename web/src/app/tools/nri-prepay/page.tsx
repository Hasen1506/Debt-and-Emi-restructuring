import { NriPrepayTool } from './tool';
import { LToolPageHeader } from '@/components/ledger/LToolPageHeader';

export default function NriPrepayPage() {
  return (
    <LToolPageHeader id="nri-prepay">
      <NriPrepayTool />
    </LToolPageHeader>
  );
}
