import { loadThemeServer } from '@/lib/theme';
import { ExistingHome } from '@/components/home/ExistingHome';
import { EditorialHome } from '@/components/home/EditorialHome';
import { LedgerHome } from '@/components/home/LedgerHome';

export default async function HomePage() {
  const theme = await loadThemeServer();
  if (theme === 'editorial') return <EditorialHome />;
  if (theme === 'ledger') return <LedgerHome />;
  return <ExistingHome />;
}
