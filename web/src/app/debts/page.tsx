import { loadThemeServer } from '@/lib/theme';
import { loadProfileServer } from '@/lib/user-store';
import { ExistingDebts } from '@/components/debts/ExistingDebts';
import { EditorialDebts } from '@/components/debts/EditorialDebts';
import { LedgerDebts } from '@/components/debts/LedgerDebts';

export default async function DebtsPage() {
  const [theme, profile] = await Promise.all([
    loadThemeServer(),
    loadProfileServer(),
  ]);
  if (theme === 'editorial') return <EditorialDebts />;
  if (theme === 'ledger') return <LedgerDebts profile={profile} />;
  return <ExistingDebts />;
}
