import { UsLetters } from '@/components/distress/UsLetters';

/**
 * US letters (round 2): hardship request, FCBA card billing dispute, RESPA
 * mortgage notice of error. Public like /cant-pay (middleware lets
 * /cant-pay/* through) and, like it, disallowed in robots.txt.
 */
export const metadata = { title: 'US letters · RightDue' };

export default function UsLettersPage() {
  return <UsLetters />;
}
