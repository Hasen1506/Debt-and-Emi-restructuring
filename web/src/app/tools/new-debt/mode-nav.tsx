'use client';

import { localTerms } from '@/lib/terms';
import { useCurrentProfile } from '@/lib/use-profile';

/** The "A loan or EMI offer" mode switch's words, as a borrower in this
 *  country says them (R9-1: a US borrower saw "EMI"). */
export const NEW_DEBT_OFFER_LABEL = 'A LOAN OR EMI OFFER';

export function newDebtOfferLabel(country: string | null | undefined): string {
  return localTerms(NEW_DEBT_OFFER_LABEL, country);
}

export function NewDebtOfferLabel() {
  const profile = useCurrentProfile();
  return <>{newDebtOfferLabel(profile.user.country)}</>;
}
