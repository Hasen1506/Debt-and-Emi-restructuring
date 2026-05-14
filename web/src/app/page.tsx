import { loadThemeServer } from '@/lib/theme';
import { ExistingHome } from '@/components/home/ExistingHome';
import { EditorialHome } from '@/components/home/EditorialHome';

export default async function HomePage() {
  const theme = await loadThemeServer();
  if (theme === 'editorial') return <EditorialHome />;
  return <ExistingHome />;
}
