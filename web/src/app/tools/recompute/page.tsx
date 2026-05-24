import { RecomputeTool } from './tool';
import { LToolPageHeader } from '@/components/ledger/LToolPageHeader';

export default function RecomputePage() {
  return (
    <LToolPageHeader id="recompute">
      <RecomputeTool />
    </LToolPageHeader>
  );
}
