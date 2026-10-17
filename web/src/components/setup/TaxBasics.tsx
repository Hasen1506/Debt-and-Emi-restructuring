'use client';

/**
 * Setup step 1's "where you live" and "how you earn" questions, and the tax
 * answers that hang off them (round 3, UX walkthrough 2 #11 / #25):
 * a Gulf or other-country NRI with Indian loans, a pensioner's age, a US
 * filing status (asked, never assumed) and whether a US filer itemizes.
 * The answers are lib/tax-setup's TaxBasics; Setup writes them on save.
 */
import { useEffect, useState } from 'react';
import type { Country, IncomeType } from '@/lib/api';
import { api, formatINR } from '@/lib/api';
import { LChip as Chip, LChipRow as ChipRow, L_T } from '@/components/ledger/primitives';
import { FILING_LABEL, GULF, abroadNote, residenceCurrency, taxBasicsGap, type TaxBasics } from '@/lib/tax-setup';
import { SE_TAX_NOTE } from '@/lib/us-self-employment';

const note = { margin: 0, fontSize: 'var(--fs-small)', color: L_T.muted, lineHeight: 1.5 } as const;

export function TaxBasicsRows(p: {
  country: Country;
  pickCountry: (c: Country) => void;
  isNriUs: boolean;
  setIsNriUs: (v: boolean) => void;
  countryNote: string | null;
  incomeType: IncomeType;
  setIncomeType: (t: IncomeType) => void;
  tb: TaxBasics;
  setTb: (tb: TaxBasics) => void;
  showErrors: boolean;
}) {
  const { country, tb, setTb } = p;
  const abroad = country === 'IN' && !!tb.residence;
  const gulf = abroad && tb.residence !== 'OTHER';
  const ccy = residenceCurrency(tb.residence === 'GULF' ? null : tb.residence);
  const [fx, setFx] = useState<string | null>(null);
  useEffect(() => {
    setFx(null);
    if (!ccy) return;
    let live = true;
    api.fxRate(ccy, 'INR').then((r) => live && setFx(`1,000 ${ccy} ≈ ${formatINR(Number(r.rate) * 1000)} today.`)).catch(() => {});
    return () => { live = false; };
  }, [ccy]);
  const gap = p.showErrors ? taxBasicsGap(country, tb) : null;
  const live = (r: TaxBasics['residence']) => { p.pickCountry('IN'); setTb({ ...tb, residence: r, earns: r ? undefined : tb.earns }); };
  return (
    <>
      <ChipRow label="Where you live">
        <Chip on={country === 'IN' && !abroad} onClick={() => live(undefined)}>India · ₹</Chip>
        <Chip on={country === 'US'} onClick={() => { p.pickCountry('US'); setTb({ ...tb, residence: undefined }); }}>USA · $</Chip>
        <Chip on={gulf} onClick={() => live(gulf ? tb.residence : 'GULF')}>Gulf · no income tax</Chip>
        <Chip on={abroad && tb.residence === 'OTHER'} onClick={() => live('OTHER')}>Another country</Chip>
        {country === 'US' && (
          <Chip on={p.isNriUs} onClick={() => p.setIsNriUs(!p.isNriUs)}>
            {p.isNriUs ? '✓ ' : '+ '}I also have loans in India
          </Chip>
        )}
      </ChipRow>
      {p.countryNote && <p role="status" style={{ margin: 0, fontSize: 'var(--fs-body)', color: L_T.negative }}>{p.countryNote}</p>}
      {gulf && (
        <ChipRow label="Which country?">
          {GULF.map((g) => <Chip key={g.code} on={tb.residence === g.code} onClick={() => setTb({ ...tb, residence: g.code })}>{g.name}</Chip>)}
        </ChipRow>
      )}
      {abroad && <p data-testid="setup-abroad-note" style={note}>{abroadNote(tb.residence!)}{fx ? ` ${fx}` : ''}</p>}
      <ChipRow label="How you earn">
        <Chip on={p.incomeType === 'salaried' && tb.earns !== 'pension'} onClick={() => { p.setIncomeType('salaried'); setTb({ ...tb, earns: undefined }); }}>Salaried</Chip>
        <Chip on={p.incomeType === 'business_owner'} onClick={() => { p.setIncomeType('business_owner'); setTb({ ...tb, earns: undefined }); }}>
          {country === 'US' ? 'Self-employed / gig' : 'Self-employed'}
        </Chip>
        {country === 'IN' && !abroad && (
          <Chip on={tb.earns === 'pension'} onClick={() => { p.setIncomeType('salaried'); setTb({ ...tb, earns: 'pension' }); }}>Retired · pension</Chip>
        )}
      </ChipRow>
      {country === 'US' && p.incomeType === 'business_owner' && <p style={note}>{SE_TAX_NOTE}</p>}
      {tb.earns === 'pension' && country === 'IN' && (
        <ChipRow label="Your age">
          <Chip on={!tb.age} onClick={() => setTb({ ...tb, age: undefined })}>Under 60</Chip>
          <Chip on={tb.age === '60_plus'} onClick={() => setTb({ ...tb, age: '60_plus' })}>60 to 79</Chip>
          <Chip on={tb.age === '80_plus'} onClick={() => setTb({ ...tb, age: '80_plus' })}>80 or over</Chip>
        </ChipRow>
      )}
      {country === 'US' && (
        <>
          <ChipRow label="How you file your tax return">
            {(Object.keys(FILING_LABEL) as Array<keyof typeof FILING_LABEL>).map((f) => (
              <Chip key={f} on={tb.filing === f} onClick={() => setTb({ ...tb, filing: f })}>{FILING_LABEL[f]}</Chip>
            ))}
          </ChipRow>
          <ChipRow label="Do you itemize deductions?">
            <Chip on={tb.itemises !== true} onClick={() => setTb({ ...tb, itemises: false })}>No, standard deduction</Chip>
            <Chip on={tb.itemises === true} onClick={() => setTb({ ...tb, itemises: true })}>Yes, I itemize</Chip>
          </ChipRow>
          <p style={note}>Mortgage interest lowers your tax only if you itemize. Most filers take the standard deduction.</p>
        </>
      )}
      {gap && <p role="alert" style={{ margin: 0, fontSize: 'var(--fs-body)', color: L_T.negative }}>{gap}</p>}
    </>
  );
}
