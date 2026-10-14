'use client';

/**
 * Lender picker for Loan Check (live test L#8, L#10).
 *
 * The verdict depends on which RBI rules bind the lender, so the screen
 * never guesses from free text: the borrower picks a listed lender (its
 * type comes with it) or names another one and states its type. The list
 * and the types come from the API (engine/lenders.py), one source of truth.
 */
import { useEffect, useId, useState } from 'react';
import { api, type LoanCheckLender, type LoanLenderType } from '@/lib/api';
import { Field, Select } from '@/components/ToolPrimitives';
import { OTHER, type LenderChoice } from '@/lib/loan-check';

export { EMPTY_CHOICE, OTHER, choiceFromName, resolveChoice, type LenderChoice } from '@/lib/loan-check';

export const TYPE_OPTIONS: { value: LoanLenderType | ''; label: string }[] = [
  { value: '', label: 'Choose the type' },
  { value: 'commercial_bank', label: 'Bank (public, private or foreign)' },
  { value: 'small_finance_bank', label: 'Small finance bank' },
  { value: 'hfc', label: 'Housing finance company (HFC)' },
  { value: 'nbfc', label: 'Other non-bank lender (NBFC)' },
  { value: 'cooperative_bank', label: 'Co-operative bank' },
  { value: 'regional_rural_bank', label: 'Regional rural bank' },
];

const GROUPS: { type: LoanLenderType; label: string }[] = [
  { type: 'commercial_bank', label: 'Banks' },
  { type: 'small_finance_bank', label: 'Small finance banks' },
  { type: 'hfc', label: 'Housing finance companies' },
];

export function useLoanCheckLenders(): { list: LoanCheckLender[]; failed: boolean } {
  const [list, setList] = useState<LoanCheckLender[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api
      .loanCheckLenders()
      .then((xs) => live && setList(xs))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);
  return { list, failed };
}

export function LenderPicker({
  value,
  onChange,
  list,
  failed,
  error,
}: {
  value: LenderChoice;
  onChange: (c: LenderChoice) => void;
  list: LoanCheckLender[];
  failed: boolean;
  error?: string | null;
}) {
  const id = useId();
  const picked = list.find((x) => x.name === value.pick);
  return (
    <div>
      <label htmlFor={id} style={{ display: 'block', fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>
        Lender
      </label>
      <select
        id={id}
        data-testid="lc-lender"
        value={value.pick}
        onChange={(e) => onChange({ ...value, pick: e.target.value })}
        aria-invalid={!!error}
        style={{ width: '100%', padding: '8px 10px', fontSize: 'var(--fs-body)' }}
      >
        <option value="">{failed ? 'List unavailable: choose "Another lender"' : 'Choose your lender'}</option>
        {GROUPS.map((g) => {
          const xs = list.filter((x) => x.type === g.type);
          return xs.length ? (
            <optgroup key={g.type} label={g.label}>
              {xs.map((x) => (
                <option key={x.id} value={x.name}>
                  {x.name}
                </option>
              ))}
            </optgroup>
          ) : null;
        })}
        <option value={OTHER}>Another lender (not listed)</option>
      </select>
      {error && (
        <span role="alert" style={{ display: 'block', fontSize: 'var(--fs-small)', color: 'var(--negative)', marginTop: 4 }}>
          {error}
        </span>
      )}
      {value.pick === OTHER && (
        <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
          <Field
            label="Lender's name"
            kind="text"
            value={value.otherName}
            onChange={(v) => onChange({ ...value, otherName: v })}
          />
          <Select
            label="What kind of lender?"
            value={value.otherType}
            onChange={(v) => onChange({ ...value, otherType: v as LoanLenderType | '' })}
            options={TYPE_OPTIONS}
          />
        </div>
      )}
      <p style={{ fontSize: 'var(--fs-small)', margin: '6px 0 0', color: 'var(--muted)' }}>
        {picked
          ? picked.rule_applies
            ? `${picked.name} is a ${picked.type === 'small_finance_bank' ? 'small finance bank' : 'bank'}: RBI's repo-rate rule applies.`
            : `${picked.name} is a housing finance company: RBI's repo-rate rule for banks does not bind it, so the check shows what does apply.`
          : 'Why we ask: RBI requires banks to link floating home-loan rates to the repo rate. Housing finance companies and other lenders follow different rules, so the answer depends on the type.'}
        {picked && !picked.has_rate_card && picked.rule_applies && ' No published new-borrower rate card for it, so that comparison is skipped.'}
      </p>
    </div>
  );
}
