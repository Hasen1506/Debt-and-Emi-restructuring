'use client';

/**
 * Setup step "What you owe" (India): an optional "Fill from your credit report"
 * card above the loan blocks, with "Type my loans instead" as an equally
 * prominent way past it (UX50 D-04, NEW-22). It reuses the Profile importer:
 * the PDF is read on RightDue's server by fixed rules, never stored; every
 * account is ticked and checked by the user, and an account that matches a loan
 * already typed is offered as an update, never added twice (D-03).
 *
 * It is never a gate: "Type my loans instead" hides it and the manual blocks
 * below work exactly as before. Profile → Loans keeps the KFS and SMS imports
 * for later (C-16 link below).
 */
import { useState } from 'react';
import type { LoanPayload } from '@/lib/api';
import { CreditReportImport } from '@/components/profile/CreditReportImport';

export function SetupImportCard({
  loans,
  blankLoan,
  todayIso,
  onAdd,
  onUpdate,
}: {
  loans: LoanPayload[];
  blankLoan: () => LoanPayload;
  todayIso: string;
  onAdd: (loans: LoanPayload[]) => void;
  onUpdate: (index: number, patch: Partial<LoanPayload>) => void;
}) {
  const [mode, setMode] = useState<'choose' | 'upload' | 'typed'>('choose');
  const [added, setAdded] = useState(0);

  if (mode === 'typed') {
    return added ? (
      <p data-testid="setup-import-done" style={{ fontSize: 12, margin: '0 0 8px' }}>
        {added} loan{added === 1 ? '' : 's'} from your credit report. Check the highlighted figures below.
      </p>
    ) : null;
  }

  const btn: React.CSSProperties = { minHeight: 48, flex: '1 1 200px', fontSize: 14 };

  return (
    <section
      data-testid="setup-import-card"
      aria-labelledby="setup-import-title"
      style={{ border: '1px solid currentColor', padding: 12, margin: '0 0 12px', display: 'grid', gap: 8 }}
    >
      <strong id="setup-import-title">Fill your loans in faster <span style={{ fontSize: 11, opacity: 0.7 }}>BETA</span></strong>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
        Your free credit report lists every loan and card in your name, even ones you&apos;ve forgotten. Upload it
        and we&apos;ll fill in what it shows. You check each one. You&apos;ll need the PDF and its password (about 1
        minute).
      </p>
      {mode === 'choose' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" style={btn} data-testid="setup-import-upload" onClick={() => setMode('upload')}>
            Upload credit report PDF
          </button>
          <button type="button" className="btn-ghost" style={{ ...btn, border: '1px solid currentColor' }} data-testid="setup-import-type" onClick={() => setMode('typed')}>
            Type my loans instead
          </button>
        </div>
      )}
      {mode === 'upload' && (
        <CreditReportImport
          startOpen
          blankLoan={blankLoan}
          todayIso={todayIso}
          existing={loans}
          onUpdate={onUpdate}
          onClose={() => setMode('typed')}
          onAdd={(list) => {
            onAdd(list);
            setAdded(list.length);
            setMode('typed');
          }}
        />
      )}
      <p style={{ margin: 0, fontSize: 11, opacity: 0.75 }}>
        Read on RightDue&apos;s server by fixed rules, then deleted. Never stored or shared. Your name, PAN and date of
        birth are not read into the app. Have a KFS or bank SMS? You can read those in Profile → Loans later.
      </p>
    </section>
  );
}
