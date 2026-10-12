import { CantPay } from '@/components/distress/CantPay';

/**
 * "I can't pay this month" triage (sprint L4). Reached from Home's
 * "Feeling overwhelmed?" soft view. Reads the saved profile on the client.
 */
export const metadata = { title: "Can't pay this month · RightDue" };

export default function CantPayPage() {
  return <CantPay />;
}
