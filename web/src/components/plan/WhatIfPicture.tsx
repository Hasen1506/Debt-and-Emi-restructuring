'use client';

/**
 * Plan what-if, drawn from a shared zero. Equal dates are a sentence.
 * A small interest gap is the two amounts in words. A gap you can see is
 * a bar on a scale that starts at zero.
 */
import type { CompareResponse } from '@/lib/api';
import { monthIndexToCountryLabel } from '@/lib/today';
import { L_T } from '@/components/ledger/primitives';
import { buildWhatIfPicture, whatIfSentence } from '@/lib/what-if-picture';

export function WhatIfPicture({
  result,
  country,
  formatInterest,
}: {
  result: CompareResponse;
  country: 'IN' | 'US';
  formatInterest: (v: number) => string;
}) {
  // compare() already drops a capped plan's paper date. A side that never
  // clears has no interest total either (the figure would be unbounded).
  const planMonth = result.baseline_never_clears ? null : result.baseline_debt_free_month ?? null;
  const nextMonth =
    result.scenario_never_clears || result.scenario_infeasible_from_month != null
      ? null
      : result.scenario_debt_free_month ?? null;
  const interestHidden = !!result.baseline_never_clears || !!result.scenario_never_clears;
  const planInterest = interestHidden ? 0 : Number(result.baseline_total_interest ?? 0);
  const nextInterest = interestHidden ? 0 : Number(result.scenario_total_interest ?? 0);
  const picture = buildWhatIfPicture({
    planMonth: planMonth ?? null,
    nextMonth: nextMonth ?? null,
    planInterest: Number.isFinite(planInterest) ? planInterest : 0,
    nextInterest: Number.isFinite(nextInterest) ? nextInterest : 0,
  });
  const sentence = interestHidden
    ? result.baseline_never_clears && !result.scenario_never_clears
      ? "As things stand the debt doesn't clear. With this, it does."
      : result.scenario_never_clears && !result.baseline_never_clears
        ? "With this, the debt doesn't clear, so there's no interest total to compare."
        : "The debt still doesn't clear, so there's no interest total to compare."
    : whatIfSentence(picture.monthsSooner, picture.interestSaved, formatInterest);
  const dateLabel = (m: number | null | undefined) => (m == null ? 'no date' : monthIndexToCountryLabel(m, country));
  const better = picture.interestSaved > 0.5 || (picture.monthsSooner ?? 0) > 0;
  const worse = picture.interestSaved < -0.5 || (picture.monthsSooner ?? 0) < 0;

  return (
    <div data-testid="what-if-picture" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
      <p data-testid="what-if-difference" style={{ margin: 0, fontSize: 12, fontWeight: 700, color: better ? L_T.positive : worse ? L_T.negative : L_T.ink }}>
        {sentence}
      </p>
      {picture.date.mode === 'axis' ? (
        <Scale
          title="DEBT-FREE"
          zero="NOW"
          end={dateLabel(picture.date.maxMonth)}
          rows={[
            { label: 'Your plan', share: picture.date.planShare, text: dateLabel(planMonth), color: L_T.inkSoft },
            { label: 'With this', share: picture.date.nextShare, text: dateLabel(nextMonth), color: (picture.monthsSooner ?? 0) > 0 ? L_T.positive : L_T.negative },
          ]}
        />
      ) : (
        <p style={{ margin: 0, fontSize: 11, color: L_T.ink }}>
          {picture.date.mode === 'same'
            ? `Debt-free ${dateLabel(planMonth)}, on your plan and with this.`
            : planMonth == null && nextMonth == null
              ? 'No debt-free date, on your plan or with this.'
              : `Your plan: ${dateLabel(planMonth)}. With this: ${dateLabel(nextMonth)}.`}
        </p>
      )}
      {!interestHidden && picture.interest.mode === 'scale' ? (
        <Scale
          title="INTEREST"
          zero={formatInterest(0)}
          end={formatInterest(picture.interest.max)}
          rows={[
            { label: 'Your plan', share: picture.interest.planShare, text: formatInterest(planInterest), color: L_T.inkSoft },
            { label: 'With this', share: picture.interest.nextShare, text: formatInterest(nextInterest), color: picture.interestSaved > 0 ? L_T.positive : L_T.negative },
          ]}
        />
      ) : picture.interest.mode === 'close' ? (
        <p style={{ margin: 0, fontSize: 11, color: L_T.ink }}>
          {formatInterest(planInterest)} on your plan, {formatInterest(nextInterest)} with this.
        </p>
      ) : null}
    </div>
  );
}

function Scale({
  title,
  zero,
  end,
  rows,
}: {
  title: string;
  zero: string;
  end: string;
  rows: { label: string; share: number; text: string; color: string }[];
}) {
  return (
    <div role="img" aria-label={`${title}: ${rows.map((r) => `${r.label} ${r.text}`).join(', ')}. Scale from ${zero} to ${end}.`}>
      <div style={{ fontSize: 10, letterSpacing: '0.12em', color: L_T.muted, marginBottom: 4 }}>{title}</div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr) auto', columnGap: 8, alignItems: 'center', fontSize: 11, marginBottom: 4 }}>
          <span style={{ color: L_T.muted }}>{r.label}</span>
          <span aria-hidden="true" style={{ display: 'block', height: 10, background: L_T.faint, border: `1px solid ${L_T.ink}` }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(1, r.share)) * 100}%`, background: r.color }} />
          </span>
          <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{r.text}</span>
        </div>
      ))}
      <div aria-hidden="true" style={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr)', columnGap: 8, fontSize: 10, color: L_T.muted }}>
        <span />
        <span style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{zero}</span>
          <span>{end}</span>
        </span>
      </div>
    </div>
  );
}
