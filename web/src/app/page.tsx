import { loadThemeServer } from '@/lib/theme';
import { loadProfileServer } from '@/lib/user-store';
import { ExistingHome } from '@/components/home/ExistingHome';
import { EditorialHome } from '@/components/home/EditorialHome';
import { LedgerHome } from '@/components/home/LedgerHome';

export default async function HomePage() {
  const [theme, profile] = await Promise.all([
    loadThemeServer(),
    loadProfileServer(),
  ]);
  if (theme === 'editorial') return <EditorialHome profile={profile} />;
  if (theme === 'ledger') return <LedgerHome profile={profile} />;
  return <ExistingHome profile={profile} />;
}
