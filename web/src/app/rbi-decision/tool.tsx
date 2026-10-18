'use client';

/**
 * /rbi-decision (audit 80+ A19): the last RBI repo decision on one loan.
 * Public, no sign-in, nothing saved: the numbers go to /api/rbi-decision
 * and back. Shows the new EMI or tenure, the choice the lender must offer,
 * and the next meeting's possible moves as scenarios, never market prices.
 */
import { useEffect, useState } from 'react';
import { Field } from '@/components/ToolPrimitives';
import { LChip, LChipRow, L_T } from '@/components/ledger/primitives';
import { LFieldGrid, LNote, LStep, LSteps } from '@/components/ledger/LToolSteps';
import { api, formatCurrency, formatPct, type RbiDecisionResponse } from '@/lib/api';
import { PLAN_HREF_MPC, impactRows, moveWords, shareText, whatsappHref } from '@/lib/loan-check-hike';
import { parsePercentInput } from '@/lib/rate-input';
import { useFormErrors } from '@/lib/form-errors';

type Latest = Pick<RbiDecisionResponse, 'decision' | 'next_meeting' | 'rates_as_of' | 'rates_source'>;

const inr = (v: string) => formatCurrency(v, 'INR');
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

const FIELDS: Record<string, string> = {
  outstanding: 'outstanding',
  current_rate: 'rate',
  tenure_months_remaining: 'months',
  emi: 'emi',
};

export function RbiDecisionTool() {
  const [latest, setLatest] = useState<Latest | null>(null);
  const [outstanding, setOutstanding] = useState('');
  const [rate, setRate] = useState('');
  const [months, setMonths] = useState('');
  const [emi, setEmi] = useState('');
  const [reached, setReached] = useState<'yes' | 'no' | 'unsure'>('unsure');
  const [res, setRes] = useState<RbiDecisionResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const { err, setErr, clear, fail, at } = useFormErrors();
  const pRate = parsePercentInput(rate);

  useEffect(() => {
    api.rbiDecisionLatest().then(setLatest).catch(() => setLatest(null));
  }, []);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const missing = [
      !outstanding && 'the outstanding balance',
      !rate && 'your current rate',
      !months && 'months left',
    ].filter(Boolean);
    if (missing.length) {
      setErr(`Still needed: ${missing.join(', ')}.`);
      return;
    }
    if (pRate.error || !pRate.fraction) {
      setErr('Fix the rate first.');
      return;
    }
    setBusy(true);
    clear();
    try {
      setRes(
        await api.rbiDecision({
          outstanding: outstanding.replace(/,/g, ''),
          current_rate: pRate.fraction,
          tenure_months_remaining: Number(months),
          emi: emi ? emi.replace(/,/g, '') : undefined,
          reached,
        }),
      );
    } catch (e2) {
      setRes(null);
      fail(e2, FIELDS);
    } finally {
      setBusy(false);
    }
  }

  const d = res?.decision ?? latest?.decision;
  const next = res?.next_meeting ?? latest?.next_meeting;
  return (
    <LSteps>
      <section data-testid="mpc-latest" aria-label="The latest RBI decision" style={{ fontSize: 'var(--fs-body)', lineHeight: 1.7, maxWidth: 820 }}>
        {d ? (
          <p style={{ margin: 0 }}>
            On <strong>{day(d.decided)}</strong> the RBI moved the repo rate from {formatPct(d.repo_from, 2)} to{' '}
            <strong>{formatPct(d.repo_to, 2)}</strong> ({moveWords(d.move)}).{' '}
            <a href={d.source_url} target="_blank" rel="noopener noreferrer" style={{ color: L_T.accent }}>
              <span aria-hidden="true">[</span>RBI&apos;S STATEMENT<span aria-hidden="true">]</span>
            </a>{' '}
            A repo-linked home loan must be reset at least once in three months, so it should reach your rate by about{' '}
            {day(d.reach_by)}.{next ? ` The next RBI decision is due on ${day(next)}.` : ''}
          </p>
        ) : (
          <p style={{ margin: 0 }}>The latest RBI repo-rate decision, worked out on your own loan.</p>
        )}
      </section>

      <LStep no="01" id="mpc-in" title="Your home loan">
        <form onSubmit={run} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <LFieldGrid>
            <Field label="Still owed" kind="money" currency="INR" value={outstanding} onChange={setOutstanding} error={at('outstanding')} />
            <Field label="Rate you pay now (%)" value={rate} onChange={setRate} placeholder="8.15" error={at('rate') ?? pRate.error} />
            <Field label="Months left" kind="integer" value={months} onChange={setMonths} placeholder="240" error={at('months')} />
            <Field label="EMI (optional)" kind="money" currency="INR" value={emi} onChange={setEmi} error={at('emi')} hint="Blank: worked out for you" />
          </LFieldGrid>
          <LChipRow label="Does your rate already include this decision?">
            <LChip on={reached === 'yes'} onClick={() => setReached('yes')}>Yes, it changed</LChip>
            <LChip on={reached === 'no'} onClick={() => setReached('no')}>No, not yet</LChip>
            <LChip on={reached === 'unsure'} onClick={() => setReached('unsure')}>Not sure</LChip>
          </LChipRow>
          <div>
            <button type="submit" disabled={busy} data-testid="mpc-submit" style={submit}>
              {busy ? 'WORKING…' : 'SHOW MY EMI'}
            </button>
            {err && (
              <p role="alert" style={{ margin: '8px 0 0', fontSize: 'var(--fs-dense)', color: L_T.negative }}>
                {err}
              </p>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: L_T.muted }}>Nothing you type here is saved.</p>
        </form>
      </LStep>

      {res && (
        <LStep no="02" id="mpc-out" title="What it does to your loan" answer>
          <div data-testid="mpc-result">
            <Choices title={`This decision: ${formatPct(res.impact.rate_before, 2)} → ${formatPct(res.impact.rate_after, 2)}`} r={res} />
            {res.notes.map((n) => (
              <LNote key={n}>{n}</LNote>
            ))}
            <p style={{ fontSize: 'var(--fs-dense)', lineHeight: 1.6, margin: '12px 0 0' }}>
              Your lender must tell you of any rise in EMI or tenure immediately and let you choose: a higher EMI, a
              longer tenure, a mix, a fixed rate where it offers one, or prepaying. If it changed your loan without
              asking, <a href="/tools/loan-check" style={{ color: L_T.accent }}>Loan Check</a> writes the letter.
            </p>
            {res.next_meeting && (
              <div data-testid="mpc-scenarios" style={{ marginTop: 16 }}>
                <p style={{ fontSize: 'var(--fs-dense)', fontWeight: 700, margin: '0 0 6px' }}>
                  If the RBI moves again on {day(res.next_meeting)}
                </p>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--fs-dense)', lineHeight: 1.7 }}>
                  {res.scenarios.map((s) => (
                    <li key={s.move}>
                      {s.impact == null
                        ? 'No change: your EMI and tenure stay as above.'
                        : `A rise of ${formatPct(s.move, 2)}: EMI ${inr(s.impact.emi_after)} (+${inr(s.impact.emi_change)} a month)${
                            s.impact.tenure_option_possible && s.impact.months_change != null
                              ? `, or ${s.impact.months_change} more months at today's EMI`
                              : ', and keeping the EMI would no longer cover the interest'
                          }.`}
                    </li>
                  ))}
                </ul>
                <p style={{ fontSize: 'var(--fs-small)', color: L_T.muted, margin: '6px 0 0' }}>
                  Scenarios, not a forecast: RightDue doesn&apos;t predict RBI decisions.
                </p>
              </div>
            )}
          </div>
        </LStep>
      )}

      <section data-testid="mpc-bridge" aria-label="Next steps" style={{ border: `1px dashed ${L_T.ink}`, padding: '14px 16px', fontSize: 'var(--fs-body)', lineHeight: 1.6 }}>
        <p style={{ margin: 0 }}>
          Want us to watch this loan, and your other EMIs, after every RBI decision?{' '}
          <a data-testid="mpc-start-plan" href={PLAN_HREF_MPC} style={{ color: L_T.accent, fontWeight: 700 }}>
            <span aria-hidden="true">[</span>START YOUR PLAN (2 MINUTES) →<span aria-hidden="true">]</span>
          </a>
        </p>
        <p style={{ margin: '8px 0 0', display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          <a data-testid="mpc-loan-check" href="/tools/loan-check" style={{ color: L_T.accent }}>
            <span aria-hidden="true">[</span>FULL LOAN CHECK: DID YOUR BANK PASS ON PAST CUTS? →<span aria-hidden="true">]</span>
          </a>
          <a href={whatsappHref(shareText('rbi-decision'))} target="_blank" rel="noopener noreferrer" style={{ color: L_T.accent }}>
            <span aria-hidden="true">[</span>SHARE ON WHATSAPP<span aria-hidden="true">]</span>
          </a>
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-small)', color: L_T.muted }}>
          RBI rates: {latest?.rates_source ?? 'rbi.org.in'}. Updated within a few hours of each RBI decision.
        </p>
      </section>
    </LSteps>
  );
}

function Choices({ title, r }: { title: string; r: RbiDecisionResponse }) {
  const rows = impactRows(r.impact);
  return (
    <div role="region" aria-label="Your choices" tabIndex={0} style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 'var(--fs-dense)', minWidth: 300, width: '100%' }}>
        <caption style={{ textAlign: 'left', fontSize: 'var(--fs-dense)', fontWeight: 700, paddingBottom: 6 }}>{title}</caption>
        <thead>
          <tr>
            <th scope="col" style={th}>Choice</th>
            <th scope="col" style={th}>EMI</th>
            <th scope="col" style={th}>Months</th>
            <th scope="col" style={th}>Interest</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.option}>
              <th scope="row" style={{ ...td, fontWeight: 600 }}>{x.option}</th>
              <td className="num" style={td}>{x.monthly}</td>
              <td className="num" style={td}>{x.months}</td>
              <td className="num" style={td}>{x.interest}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const submit: React.CSSProperties = {
  border: `2px solid ${L_T.ink}`,
  background: L_T.ink,
  color: L_T.bg,
  padding: '10px 16px',
  fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)',
  letterSpacing: '0.12em',
  fontWeight: 700,
  cursor: 'pointer',
  minHeight: 44,
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 12px 6px 0',
  borderBottom: '1px solid var(--border)',
  fontWeight: 500,
  fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)',
  letterSpacing: '0.12em',
  color: 'var(--muted)',
};
const td: React.CSSProperties = { padding: '6px 12px 6px 0', verticalAlign: 'top' };
