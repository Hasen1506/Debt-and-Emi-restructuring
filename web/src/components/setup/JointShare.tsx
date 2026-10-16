'use client';

/** UX2B-9: "Taken jointly? Your share" on a Setup home loan (lib/joint-share). */
import type { LoanPayload } from '@/lib/api';
import { Field } from '@/components/ToolPrimitives';
import { sharePatch, shareText } from '@/lib/joint-share';

export function JointShare({ loan, onPatch }: { loan: LoanPayload; onPatch: (p: Partial<LoanPayload>) => void }) {
  if (loan.loan_type !== 'home_loan') return null;
  const t = shareText(loan);
  return (
    <Field
      label="Taken jointly? Your share, % (optional)"
      kind="decimal"
      value={t}
      placeholder="100"
      onChange={(v) => onPatch(sharePatch(v))}
      hint="Enter the whole loan’s balance and EMI above. The plan counts your share of them, and your tax break on it."
    />
  );
}
