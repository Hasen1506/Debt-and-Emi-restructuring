import { loadThemeServer } from '@/lib/theme';
import { ExistingDebts } from '@/components/debts/ExistingDebts';
import { EditorialDebts } from '@/components/debts/EditorialDebts';

export default async function DebtsPage() {
  const theme = await loadThemeServer();
  if (theme === 'editorial') return <EditorialDebts />;
  return <ExistingDebts />;
}
