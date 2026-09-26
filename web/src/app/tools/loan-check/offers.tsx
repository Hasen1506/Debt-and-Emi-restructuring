'use client';

/**
 * Offer comparison under a Loan Check result. The usual reply to a
 * complaint or a request for a lower rate is "our current rate, for a
 * fee". This compares keeping the loan, paying that fee, and moving the
 * loan to another lender, and says which is cheapest.
 *
 * When Loan Check found a cut the bank owes, the server measures savings
 * against the loan at that rate, so a fee that only buys the owed cut
 * never shows as a saving.
 */
import { useState } from 'react';
import { Card } from '@/components/Card';
import { Field, Select } from '@/components/ToolPrimitives';
import {
  api,
  ApiFieldError,
  formatCurrency,
  formatPct,
  type LoanCheckRequest,
  type OfferCompareResponse,
  type OfferMode,
  type OfferOption,
} from '@/lib/api';
import { parseAmountInput, parseFeeInput, type ParsedFee } from '@/lib/fee-input';
import { parsePercentInput } from '@/lib/rate-input';
import { Citations } from './complaint';
import { RateProblem } from './rate-problem';

const MODE_OPTIONS: { value: OfferMode; label: string }[] = [
  { value: 'lower_emi', label: 'Lower EMI, same end date' },
  { value: 'same_emi', label: 'Same EMI, finish sooner' },
];

const inr = (v: string) => formatCurrency(v, 'INR');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2027-10-01" → "Oct 2027", the same wording the server uses. */
function monthYear(iso: string): string {
  const [y, m] = iso.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

function span(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const ys = y ? `${y} year${y > 1 ? 's' : ''}` : '';
  const ms = m ? `${m} month${m > 1 ? 's' : ''}` : '';
  return [ys, ms].filter(Boolean).join(' ');
}

function FeeProblem({ parsed, onFix }: { parsed: ParsedFee; onFix: (v: string) => void }) {
  if (!parsed.error) return null;
  return (
    <span role="alert" style={{ fontSize: 11, color: 'var(--negative)' }}>
      {parsed.error}{' '}
      {parsed.suggestion && (
        <button
          type="button"
          onClick={() => onFix(parsed.suggestion as string)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            color: 'var(--accent)',
            textDecoration: 'underline',
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          Use {parsed.suggestion}
        </button>
      )}
    </span>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function OfferPanel({ request }: { request: LoanCheckRequest }) {
  const bank = request.lender?.trim() || 'your bank';
  const [resetRate, setResetRate] = useState('');
  const [resetFee, setResetFee] = useState('');
  const [resetGst, setResetGst] = useState(true);
  const [newLender, setNewLender] = useState('');
  const [refiRate, setRefiRate] = useState('');
  const [refiFee, setRefiFee] = useState('');
  const [refiGst, setRefiGst] = useState(true);
  const [stamp, setStamp] = useState('');
  const [legal, setLegal] = useState('');
  const [closing, setClosing] = useState('');
  const [newTerm, setNewTerm] = useState('');
  const [years, setYears] = useState('');
  const [mode, setMode] = useState<OfferMode>('lower_emi');
  const [res, setRes] = useState<OfferCompareResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pReset = parsePercentInput(resetRate);
  const pRefi = parsePercentInput(refiRate);
  const pResetFee = parseFeeInput(resetFee);
  const pRefiFee = parseFeeInput(refiFee);
  const pStamp = parseAmountInput(stamp);
  const pLegal = parseAmountInput(legal);
  const pClosing = parseAmountInput(closing);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const problems = [pReset, pRefi, pResetFee, pRefiFee, pStamp, pLegal, pClosing].filter((p) => p.error);
    if (problems.length) {
      setErr('Fix the highlighted fields first.');
      return;
    }
    if (!pReset.fraction && !pRefi.fraction) {
      setErr(`Still needed: the rate ${bank} offered, or a new lender's rate.`);
      return;
    }
    const yearsN = years.trim() ? Number(years) : null;
    if (yearsN !== null && !(yearsN > 0 && yearsN <= 40)) {
      setErr('Years you expect to keep the loan must be between 1 and 40.');
      return;
    }
    const termN = newTerm.trim() ? Number(newTerm) : null;
    if (termN !== null && !(Number.isInteger(termN) && termN >= 1 && termN <= 480)) {
      setErr("The new loan's term must be between 1 and 480 months.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.compareOffers({
        ...request,
        mode,
        horizon_months: yearsN !== null ? Math.round(yearsN * 12) : undefined,
        reset: pReset.fraction
          ? {
              rate: pReset.fraction,
              fee: pResetFee.amount ?? undefined,
              fee_percent: pResetFee.percent ?? undefined,
              fee_plus_gst: resetGst,
            }
          : undefined,
        refinance: pRefi.fraction
          ? {
              rate: pRefi.fraction,
              lender: newLender.trim() || undefined,
              processing_fee: pRefiFee.amount ?? undefined,
              processing_fee_percent: pRefiFee.percent ?? undefined,
              fee_plus_gst: refiGst,
              stamp_duty: pStamp.amount ?? undefined,
              legal_and_valuation: pLegal.amount ?? undefined,
              prepayment_charge: pClosing.amount ?? undefined,
              months: termN ?? undefined,
            }
          : undefined,
      });
      setRes(r);
    } catch (e) {
      setRes(null);
      setErr(e instanceof ApiFieldError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const grid = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 12,
  } as const;

  return (
    <Card>
      <h2 style={{ fontSize: 20, margin: 0 }}>Got an offer? Compare it</h2>
      <p style={{ margin: '6px 0 14px', fontSize: 14 }}>
        Banks often reply with &ldquo;our current rate, for a fee&rdquo;. Enter what{' '}
        {bank} offered, a quote from another lender, or both. You&apos;ll see what
        each choice costs from today and which is cheapest.
      </p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>
            {bank === 'your bank' ? "Your bank's offer" : `${bank}'s offer`}
          </legend>
          <div style={grid}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Field label="Rate offered (%)" value={resetRate} onChange={setResetRate} placeholder="8.15" />
              <RateProblem parsed={pReset} onFix={setResetRate} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Field
                label="Fee (₹ or % of the loan)"
                kind="text"
                value={resetFee}
                onChange={setResetFee}
                placeholder="25000 or 0.35%"
              />
              <FeeProblem parsed={pResetFee} onFix={setResetFee} />
            </div>
            <Check label="The fee is quoted plus GST" checked={resetGst} onChange={setResetGst} />
          </div>
        </fieldset>

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>
            Another lender&apos;s quote (optional)
          </legend>
          <div style={grid}>
            <Field label="New lender" kind="text" value={newLender} onChange={setNewLender} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Field label="Rate (%)" value={refiRate} onChange={setRefiRate} placeholder="7.60" />
              <RateProblem parsed={pRefi} onFix={setRefiRate} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Field
                label="Processing fee (₹ or %)"
                kind="text"
                value={refiFee}
                onChange={setRefiFee}
                placeholder="10000 or 0.5%"
              />
              <FeeProblem parsed={pRefiFee} onFix={setRefiFee} />
            </div>
            <Check label="The processing fee is quoted plus GST" checked={refiGst} onChange={setRefiGst} />
            <Field
              label="Stamp duty (₹)"
              value={stamp}
              onChange={setStamp}
              hint="On the new mortgage. Set by your state; ask the lender."
            />
            <Field label="Legal and valuation (₹)" value={legal} onChange={setLegal} />
            <Field
              label={`Charge from ${bank} to close (₹)`}
              value={closing}
              onChange={setClosing}
              hint="Usually nil on a floating-rate home loan."
            />
            <Field
              label="New term (months, optional)"
              kind="integer"
              value={newTerm}
              onChange={setNewTerm}
              hint="Leave blank to keep the months you have left."
            />
          </div>
        </fieldset>

        <div style={grid}>
          <Field
            label="Years you expect to keep this loan (optional)"
            value={years}
            onChange={setYears}
            hint="If you may sell or prepay early. Blank means the full term."
          />
          <Select label="After a rate cut" value={mode} onChange={setMode} options={MODE_OPTIONS} />
        </div>

        <div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Comparing…' : 'Compare'}
          </button>
          {err && (
            <span role="alert" style={{ marginLeft: 12, color: 'var(--negative)', fontSize: 13 }}>
              {err}
            </span>
          )}
        </div>
      </form>

      <div aria-live="polite">{res && <OfferResult r={res} />}</div>
    </Card>
  );
}

function OfferResult({ r }: { r: OfferCompareResponse }) {
  const horizon = `over ${span(r.horizon_months)}`;
  const color = r.verdict === 'keep' ? 'var(--ink)' : 'var(--positive)';
  return (
    <div style={{ marginTop: 20 }}>
      <h3 style={{ fontSize: 18, margin: '0 0 6px', color }}>{r.headline}</h3>
      <p style={{ fontSize: 14, margin: '0 0 8px' }}>{r.reason}</p>
      {r.warnings.map((w) => (
        <p key={w} style={{ fontSize: 14, margin: '0 0 8px', color: 'var(--accent)' }}>
          {w}
        </p>
      ))}
      <p style={{ fontSize: 14, margin: '0 0 12px' }}>
        <strong>Next step:</strong> {r.next_step}
      </p>
      <div
        role="region"
        aria-label="Offer comparison table"
        tabIndex={0}
        style={{ overflowX: 'auto' }}
      >
        <table style={{ borderCollapse: 'collapse', fontSize: 14, width: '100%', minWidth: 560 }}>
          <thead>
            <tr style={{ textAlign: 'right' }}>
              <th scope="col" style={{ textAlign: 'left', padding: '6px 8px 6px 0' }}>Choice</th>
              <th scope="col" style={{ padding: 6 }}>Rate</th>
              <th scope="col" style={{ padding: 6 }}>EMI</th>
              <th scope="col" style={{ padding: 6 }}>Paid up front</th>
              <th scope="col" style={{ padding: 6 }}>Cost {horizon}</th>
              <th scope="col" style={{ padding: 6 }}>Saving</th>
              <th scope="col" style={{ padding: '6px 0 6px 6px' }}>Pays for itself</th>
            </tr>
          </thead>
          <tbody>
            {r.options.map((o) => (
              <OptionRow key={o.key} o={o} baseline={r.baseline} verdict={r.verdict} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
        Cost is the interest paid {horizon} plus money paid up front. Saving is against
        &ldquo;{r.options.find((o) => o.key === r.baseline)?.label}&rdquo;.
      </p>
      {r.notes.map((n) => (
        <p key={n} className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
          {n}
        </p>
      ))}
      <UpfrontDetail options={r.options} />
      <Citations items={r.citations} />
    </div>
  );
}

function OptionRow({ o, baseline, verdict }: { o: OfferOption; baseline: string; verdict: string }) {
  const chosen = verdict === 'keep' ? o.key === baseline : o.key === verdict;
  const saving = Number(o.saving);
  let pays = '—';
  if (o.break_even_month === 0) pays = 'Straight away';
  else if (o.break_even_on && o.break_even_month)
    pays = `${monthYear(o.break_even_on)} (month ${o.break_even_month})`;
  else if (o.key === 'reset' || o.key === 'refinance') pays = 'Never';
  return (
    <tr style={{ borderTop: '1px solid var(--border)', textAlign: 'right', fontWeight: chosen ? 600 : 400 }}>
      <th scope="row" style={{ textAlign: 'left', padding: '6px 8px 6px 0', fontWeight: chosen ? 600 : 500 }}>
        {o.label}
        {chosen && <span style={{ color: 'var(--positive)' }}> ✓</span>}
      </th>
      <td className="num" style={{ padding: 6 }}>{formatPct(o.rate)}</td>
      <td className="num" style={{ padding: 6 }}>
        {inr(o.emi)}
        <span className="muted" style={{ display: 'block', fontSize: 11 }}>
          {o.months} months
        </span>
      </td>
      <td className="num" style={{ padding: 6 }}>{Number(o.upfront_total) ? inr(o.upfront_total) : '—'}</td>
      <td className="num" style={{ padding: 6 }}>{inr(o.cost_to_horizon)}</td>
      <td
        className="num"
        style={{
          padding: 6,
          color: saving > 0 ? 'var(--positive)' : saving < 0 ? 'var(--negative)' : undefined,
        }}
      >
        {o.key === baseline ? '—' : saving < 0 ? `−${inr(String(-saving))}` : inr(o.saving)}
      </td>
      <td style={{ padding: '6px 0 6px 6px' }}>{pays}</td>
    </tr>
  );
}

function UpfrontDetail({ options }: { options: OfferOption[] }) {
  const withCosts = options.filter((o) => o.upfront.length > 0);
  if (!withCosts.length) return null;
  return (
    <details style={{ marginTop: 10, fontSize: 13 }}>
      <summary style={{ cursor: 'pointer' }}>What is paid up front</summary>
      {withCosts.map((o) => (
        <div key={o.key} style={{ marginTop: 6 }}>
          <strong>{o.label}</strong>
          <ul style={{ paddingLeft: 18, margin: '4px 0 0' }}>
            {o.upfront.map((c) => (
              <li key={c.label}>
                {c.label}: {inr(c.amount)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </details>
  );
}
