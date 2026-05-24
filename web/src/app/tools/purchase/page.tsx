import { PurchaseTool } from './tool';
import { LToolPageHeader } from '@/components/ledger/LToolPageHeader';

export default function PurchasePage() {
  return (
    <LToolPageHeader id="purchase">
      <PurchaseTool />
    </LToolPageHeader>
  );
}
