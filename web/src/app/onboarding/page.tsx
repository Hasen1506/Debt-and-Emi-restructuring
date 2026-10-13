import { QuickSetup } from '@/components/setup/QuickSetup';

/** Its own tab title (UX50 C-26 / E-15). */
export const metadata = { title: 'Set up · RightDue' };

/** First run: three steps (REDESIGN R1). The full editor is /profile. */
export default function SetupPage() {
  return <QuickSetup />;
}
