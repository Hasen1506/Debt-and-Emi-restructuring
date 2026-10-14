'use client';

/**
 * E7 (audit 80): a US student loan in Setup asks the two questions that
 * decide whether extra money should ever go to it: federal or private, and
 * whether it is on PSLF or an income-driven plan. Until answered, extra is
 * held off the loan (engine/us_loans.py forgiveness_answer_pending).
 */
import type { LoanPayload } from '@/lib/api';
import { LChip as Chip, LChipRow as ChipRow } from '@/components/ledger/primitives';
import { forgivenessPrepayBlock } from '@/lib/us-loans';

export function UsStudentChips({
  loan,
  onPatch,
}: {
  loan: LoanPayload;
  onPatch: (p: Partial<LoanPayload>) => void;
}) {
  const kind = loan.student_loan_kind ?? '';
  const track = loan.forgiveness_track ?? '';
  const held = forgivenessPrepayBlock({ ...loan, currency: loan.currency || 'USD' }, 'US');
  return (
    <div data-testid="setup-us-student" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <ChipRow label="Federal or private?">
        <Chip on={kind === 'federal'} onClick={() => onPatch({ student_loan_kind: 'federal' })}>Federal</Chip>
        <Chip
          on={kind === 'private'}
          onClick={() => onPatch({ student_loan_kind: 'private', forgiveness_track: undefined })}
        >
          Private
        </Chip>
        <Chip on={kind === ''} onClick={() => onPatch({ student_loan_kind: undefined })}>Not sure</Chip>
      </ChipRow>
      {kind !== 'private' && (
        <ChipRow label="On PSLF or an income-driven plan?">
          <Chip on={track === 'pslf'} onClick={() => onPatch({ forgiveness_track: 'pslf' })}>PSLF</Chip>
          <Chip on={track === 'idr'} onClick={() => onPatch({ forgiveness_track: 'idr' })}>Income-driven</Chip>
          <Chip on={track === 'none'} onClick={() => onPatch({ forgiveness_track: 'none' })}>No</Chip>
          <Chip
            on={track === '' || track === 'unsure'}
            onClick={() => onPatch({ forgiveness_track: 'unsure' })}
          >
            Not sure
          </Chip>
        </ChipRow>
      )}
      {held && (
        <p role="note" style={{ margin: 0, fontSize: 12 }}>
          Extra held off this loan: it {held}.
        </p>
      )}
    </div>
  );
}
