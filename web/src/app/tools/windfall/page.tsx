import { WindfallTool } from './tool';
import { LToolPageHeader } from '@/components/ledger/LToolPageHeader';

export default function WindfallPage() {
  return (
    <LToolPageHeader id="windfall">
      <WindfallTool />
    </LToolPageHeader>
  );
}
