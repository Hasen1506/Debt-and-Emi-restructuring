import { loadProfileServer } from '@/lib/user-store';
import { LedgerDebts } from '@/components/debts/LedgerDebts';

export default async function DebtsPage() {
  const profile = await loadProfileServer();
  return (
    <>
      <h1 className="sr-only">Your debts</h1>
      <LedgerDebts profile={profile} />
    </>
  );
}
