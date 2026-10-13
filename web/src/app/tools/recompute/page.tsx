import { redirect } from 'next/navigation';

/** Its own tab title (UX50 C-26 / E-15). */
export const metadata = { title: 'Recompute · RightDue' };

// Recompute was the what-if panel's one-off payment with a separate form;
// /plan's what-if does the same and logs it. Old links land there.
export default function RecomputePage() {
  redirect('/plan#what-if');
}
