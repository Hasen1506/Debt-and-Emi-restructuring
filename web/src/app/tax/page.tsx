import { redirect } from 'next/navigation';

/**
 * /tax: folded into Profile (REDESIGN V5). Its rows (country, regime or
 * filing status, the tax rate the plan uses) are Profile's "Where you live
 * and tax" section, with what they change; old links land there.
 */
export default function TaxPage() {
  redirect('/profile#pf-tax');
}
