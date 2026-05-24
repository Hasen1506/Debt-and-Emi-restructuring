import { LiquidateTool } from './tool';
import { LToolPageHeader } from '@/components/ledger/LToolPageHeader';

export default function LiquidatePage() {
  return (
    <LToolPageHeader id="liquidate">
      <LiquidateTool />
    </LToolPageHeader>
  );
}
