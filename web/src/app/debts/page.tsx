import { loadThemeServer } from '@/lib/theme';
import { ExistingDebts } from '@/components/debts/ExistingDebts';
import { EditorialDebts } from '@/components/debts/EditorialDebts';
import { LedgerDebts } from '@/components/debts/LedgerDebts';

export default async function DebtsPage() {
  const theme = await loadThemeServer();
  if (theme === 'editorial') return <EditorialDebts />;
  if (theme === 'ledger') return <LedgerDebts />;
  return <ExistingDebts />;
}
