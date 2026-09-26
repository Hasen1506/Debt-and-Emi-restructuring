import { loadProfileServer } from '@/lib/user-store';
import { LedgerHome } from '@/components/home/LedgerHome';

export default async function HomePage() {
  const profile = await loadProfileServer();
  // The ledger layout shows no page title; screen readers still need one.
  return (
    <>
      <h1 className="sr-only">Home</h1>
      <LedgerHome profile={profile} />
    </>
  );
}
