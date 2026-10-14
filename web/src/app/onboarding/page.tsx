import { QuickSetup } from '@/components/setup/QuickSetup';
import { SetupFunnel } from '@/components/setup/SetupFunnel';

/** Its own tab title (UX50 C-26 / E-15). */
export const metadata = { title: 'Set up · RightDue' };

/** First run: three steps (REDESIGN R1). The full editor is /profile.
 *  SetupFunnel counts where people stop (A15); off unless NEXT_PUBLIC_FUNNEL=1. */
export default function SetupPage() {
  return (
    <SetupFunnel>
      <QuickSetup />
    </SetupFunnel>
  );
}
