'use client';

import { useMemo, useState } from 'react';
import { Card } from '@/components/Card';
import {
  ApplyAction,
  Field,
  InfoTip,
  Select,
  Stat,
  SubmitBar,
  VerdictHeader,
} from '@/components/ToolPrimitives';
import {
  api,
  formatCurrency,
  formatPct,
  type CashYieldResponse,
  type Country,
} from '@/lib/api';
import { useStoredProfile } from '@/lib/use-profile';
import { useFormErrors } from '@/lib/form-errors';
import { deriveMetrics } from '@/lib/derived';
import { applyToolResult } from '@/lib/apply-tool-result';
import { userDefaultCurrency } from '@/lib/currency';
import { fitColumns } from '@/lib/grid';


// The API's field names → this form's inputs, so a rejected value's
// message shows under the input it came from.
const FIELDS: Record<string, string> = {
  idle_balance: 'idle',
  current_yield: 'yieldNow',
  top_loan_effective_rate: 'topRate',
};

export function CashYieldTool() {
  const profile = useStoredProfile();
  const loudest = useMemo(() => deriveMetrics(profile).loudest, [profile]);
  const [idle, setIdle] = useState(profile.user.savings_balance ?? '');
  const [yieldNow, setYieldNow] = useState('0.025');
  const [country, setCountry] = useState<Country>(profile.user.country);
  const [topRate, setTopRate] = useState(
    loudest ? loudest.effective.toFixed(4) : '',
  );
  const [v, setV] = useState<CashYieldResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const { err, setErr, clear, fail, at } = useFormErrors();
  const [applied, setApplied] = useState(false);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    clear();
    setApplied(false);
    try {
      setV(
        await api.cashYield({
          idle_balance: idle,
          current_yield: yieldNow,
          country,
          top_loan_effective_rate: topRate || undefined,
        }),
      );
    } catch (e) {
      fail(e, FIELDS);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card>
        <form
          onSubmit={check}
          style={{ display: 'grid', gap: 12, gridTemplateColumns: fitColumns(2, 200) }}
        >
          <Field
            label="Idle balance"
            value={idle}
            error={at('idle')}
            onChange={setIdle}
            info={
              <>
                Cash sitting in your savings account beyond your emergency
                fund. We&apos;d typically not touch the e-fund itself —
                that&apos;s for emergencies, not yield optimisation.
              </>
            }
          />
          <Field
            label="Current yield (%)"
            kind="percent"
            value={yieldNow}
            error={at('yieldNow')}
            onChange={setYieldNow}
            hint="e.g. 2.5"
            info={
              <>
                What this cash is currently earning, pre-tax. Most IN
                savings accounts pay 2.5–4%. US checking pays ~0%; HYSAs
                pay 4–5%.
              </>
            }
          />
          <Select
            label="Country"
            value={country}
            error={at('country')}
            onChange={setCountry}
            options={[
              { value: 'IN' as Country, label: 'India' },
              { value: 'US' as Country, label: 'USA' },
            ]}
          />
          <Field
            label="Top loan effective rate (decimal, optional)"
            value={topRate}
            error={at('topRate')}
            onChange={setTopRate}
            hint="Comparison against prepaying"
            info={
              <>
                The <strong>effective</strong> after-tax interest rate on
                your most expensive loan. For credit cards, effective ≈
                nominal. For home loans, subtract the tax benefit (Sec 80C
                / 24b / 80EEA in IN, mortgage interest deduction in US).
                If this is higher than the best parking option, prepaying
                the loan beats moving the cash.
              </>
            }
          />
          <SubmitBar busy={busy} error={err} label="Check yield" />
        </form>
      </Card>

      {v && !v.alert && (
        <Card>
          <VerdictHeader
            label="No action needed"
            color="var(--muted)"
            detail="Either the idle balance is small enough that moving it isn't worth the friction, or the yield gap is under 1pp."
          />
        </Card>
      )}

      {v && v.alert && (
        <Card>
          <VerdictHeader
            label={v.beats_top_loan ? `Move to ${v.alt_name}` : 'Prepay top loan first'}
            color={v.beats_top_loan ? 'var(--accent)' : 'var(--positive)'}
            detail={v.rationale ?? ''}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: fitColumns(3, 140),
              gap: 12,
            }}
          >
            <Stat
              label="Current yield"
              value={v.current_yield ? formatPct(v.current_yield, 2) : '—'}
            />
            <Stat
              label={
                <>
                  Better yield{' '}
                  <InfoTip>
                    The country&apos;s best liquid alternative — IN: typically
                    a liquid mutual fund or 12-mo FD (6–7%). US: HYSA or
                    1-yr T-bill. Same liquidity as savings, materially
                    higher yield.
                  </InfoTip>
                </>
              }
              value={v.best_alt_yield ? formatPct(v.best_alt_yield, 2) : '—'}
              color="var(--accent)"
            />
            <Stat
              label={
                <>
                  Annual uplift{' '}
                  <InfoTip>
                    Yield gap × idle balance. Pre-tax — the actual after-tax
                    figure depends on which bucket the alternative lives
                    in (FD interest is taxed at slab; liquid-fund LTCG at
                    12.5%).
                  </InfoTip>
                </>
              }
              value={v.annual_uplift ? formatCurrency(v.annual_uplift, userDefaultCurrency(country)) : '—'}
              color="var(--positive)"
            />
          </div>
          {!v.beats_top_loan && loudest && profile.isLive && (
            <ApplyAction
              applied={applied}
              onApply={() => {
                const sched = loudest.loan.scheduled_emi || '0';
                applyToolResult({
                  loanIndex: loudest.index,
                  kind: 'paid_extra',
                  amount: String(Number(sched) + Number(idle)),
                  scheduledEmi: sched,
                  note: `Idle cash redirected to prepay — ${formatCurrency(idle, userDefaultCurrency(country))} to ${loudest.loan.bank}`,
                  loans: profile.user.loans,
                  country: profile.user.country,
                });
                setApplied(true);
              }}
              label={`Apply this — log ${formatCurrency(idle, userDefaultCurrency(country))} to ${loudest.loan.bank} & reprice /plan`}
            />
          )}
        </Card>
      )}
    </div>
  );
}
