import { LBracket, L_T } from '@/components/ledger/primitives';
import { US_LETTERS_PATH } from '@/lib/us-letters';

/** The way from Can't pay (USA) to the US letters page (round 2). */
export function UsLettersLink() {
  return (
    <p style={{ fontSize: 'var(--fs-body)', lineHeight: 1.6, margin: '10px 0 0' }} data-testid="cp-us-letters-link">
      A wrong charge on a card statement, or a mortgage servicer&apos;s mistake? There are federal letters for those too,
      with the deadlines the lender must meet.{' '}
      <LBracket href={US_LETTERS_PATH}>US LETTERS →</LBracket>
      <span style={{ display: 'block', fontSize: 'var(--fs-small)', color: L_T.muted }}>
        Hardship request · card billing dispute (FCBA) · mortgage notice of error (RESPA)
      </span>
    </p>
  );
}
