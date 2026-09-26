import { redirect } from 'next/navigation';

// Recompute was the what-if panel's one-off payment with a separate form;
// /plan's what-if does the same and logs it. Old links land there.
export default function RecomputePage() {
  redirect('/plan#what-if');
}
