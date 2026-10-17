'use client';

/**
 * Founder decision 17 Oct 2026: once the payments logged on a loan marked
 * "behind" since then cover what it was behind by, Home asks to set it back
 * to paying normally (one tap; nothing changes until the user says so).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LoanPayload } from '@/lib/api';
import { formatCurrencyWhole } from '@/lib/api';
import { readActivityClient } from '@/lib/activity';
import { catchUpProgress } from '@/lib/catch-up';
import { loadProfileClient, saveProfileClient } from '@/lib/user-store';
import { getCountryToday, localIsoDate } from '@/lib/today';
import { loanCurrency } from '@/lib/currency';
import { LBracket } from '@/components/ledger/primitives';

export function CatchUpCheck({ loan, index, name, country }: { loan: LoanPayload; index: number; name: string; country: 'IN' | 'US' }) {
  const router = useRouter();
  const [p, setP] = useState<ReturnType<typeof catchUpProgress> | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const read = () => setP(catchUpProgress(loan, index, readActivityClient(), localIsoDate(getCountryToday(country))));
    read();
    window.addEventListener('storage', read);
    return () => window.removeEventListener('storage', read);
  }, [loan, index, country]);
  if (!p?.caughtUp || done) return null;
  const fmt = (v: number) => formatCurrencyWhole(v, loanCurrency(loan, country));

  function backToNormal() {
    const stored = loadProfileClient();
    const list = stored.user.loans ?? [];
    const at = loan.id ? list.findIndex((l) => l.id === loan.id) : index;
    if (at < 0 || !list[at]) return;
    const next = list.map((l, k) => (k === at ? { ...l, debt_status: undefined, overdue_amount: undefined, overdue_as_of: undefined } : l));
    if (saveProfileClient({ ...stored, user: { ...stored.user, loans: next } })) {
      setDone(true);
      router.refresh();
    }
  }

  return (
    <p data-testid="catch-up-done" style={{ fontSize: 'var(--fs-dense)', lineHeight: 1.55, margin: '4px 0' }}>
      Caught up on {name}? You’ve logged {fmt(p.logged)} since it was marked behind
      ({fmt(p.overdue)} overdue{p.estimated ? ', estimated as one EMI' : ''}).{' '}
      <LBracket active onClick={backToNormal}>SET IT BACK TO PAYING NORMALLY</LBracket>
    </p>
  );
}
