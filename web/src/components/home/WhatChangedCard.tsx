'use client';

/** This month's changes, read only from the change log. */
import { useEffect, useState } from 'react';
import { readChangeLog, savePlanFacts, type ChangeEntry } from '@/lib/change-log';
import { whatChanged } from '@/lib/what-changed';
import { readMonthlySpendClient, recentSpendAverage } from '@/lib/monthly-spend';
import { LSectionHeader, LBracket } from '@/components/ledger/primitives';

export function WhatChangedCard({
  month,
  debtFree,
  interest,
}: {
  month: string;
  debtFree?: string;
  interest?: string;
}) {
  const [rows, setRows] = useState<ChangeEntry[]>([]);
  const [average, setAverage] = useState<number | null>(null);
  useEffect(() => {
    if (debtFree || interest) savePlanFacts({ month, debtFree: debtFree || 'not set', interest: interest || 'not set' });
    setRows(readChangeLog());
    setAverage(recentSpendAverage(readMonthlySpendClient(), month)?.average ?? null);
    const on = () => setRows(readChangeLog());
    window.addEventListener('storage', on);
    return () => window.removeEventListener('storage', on);
  }, [month, debtFree, interest]);

  const card = whatChanged(rows, month, average);
  return (
    <section aria-labelledby="what-changed-h" data-testid="what-changed">
      <LSectionHeader right={<LBracket href="/activity">THE FULL LOG →</LBracket>}>
        <span id="what-changed-h">What changed</span>
      </LSectionHeader>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
        {card.lines.map((line, i) => <li key={`${i}-${line}`}>{line}</li>)}
      </ul>
    </section>
  );
}
