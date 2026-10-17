import { QuickSetup } from '@/components/setup/QuickSetup';
import { SetupFunnel } from '@/components/setup/SetupFunnel';

/** Its own tab title (UX50 C-26 / E-15). */
export const metadata = { title: 'Set up · RightDue' };

/** First run: three steps (REDESIGN R1). The full editor is /profile.
 *  SetupFunnel counts where people stop (A15); off unless NEXT_PUBLIC_FUNNEL=1.
 *
 *  Audit 80+ E10: Setup's form is drawn in the browser, so the page used to
 *  paint header + footer first and the footer jumped down 0.196 of the
 *  screen when the form arrived. The shell holds a screen's height from the
 *  first paint, so the footer starts below the fold and nothing visible
 *  moves. */
export default function SetupPage() {
  return (
    <div className="rd-setup-shell">
      <SetupFunnel>
        <QuickSetup />
      </SetupFunnel>
    </div>
  );
}
