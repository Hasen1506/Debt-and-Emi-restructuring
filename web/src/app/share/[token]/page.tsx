import { LShell, LSectionHeader, L_T } from '@/components/ledger/primitives';
import { serverApiBase } from '@/lib/api-base';
import { formatCurrencyWhole, type SharedPlan } from '@/lib/api';

export const metadata = { title: 'A shared plan · RightDue', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

async function load(token: string): Promise<SharedPlan | null> {
  if (!TOKEN.test(token)) return null;
  const base = serverApiBase().replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/api/share/${token}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as SharedPlan;
  } catch {
    return null;
  }
}

function money(currency: SharedPlan['currency'], value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return formatCurrencyWhole(Math.round(n), currency === 'USD' ? 'USD' : 'INR');
}

function rate(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return `${Math.round(n * 1000) / 10}%`;
}

export default async function SharedPlanPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const plan = await load(token);
  if (!plan) {
    return (
      <LShell>
        <h1 style={{ fontSize: 18, margin: '8px 0' }}>This link is not active</h1>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: L_T.inkSoft }}>
          The person who shared the plan has turned the link off, or the address is incomplete.
        </p>
      </LShell>
    );
  }
  return (
    <LShell>
      <h1 style={{ fontSize: 18, margin: '8px 0' }}>A shared plan</h1>
      <p data-testid="share-note" style={{ fontSize: 13, lineHeight: 1.6, color: L_T.inkSoft }}>{plan.note}</p>
      <section aria-labelledby="share-stand">
        <LSectionHeader>
          <span id="share-stand">Where the plan stands</span>
        </LSectionHeader>
        <p style={{ fontSize: 13, lineHeight: 1.6 }}>
          {plan.loan_count} open {plan.loan_count === 1 ? 'loan' : 'loans'}.
          {plan.debt_free ? ` Debt-free date: ${plan.debt_free}.` : ''}
          {plan.interest ? ` Interest on the plan: ${plan.interest}.` : ''}
        </p>
      </section>
      {plan.hide_loans ? (
        <p data-testid="share-hidden" style={{ fontSize: 13, lineHeight: 1.6 }}>
          Individual loans are hidden on this link.
        </p>
      ) : (
        <ul data-testid="share-loans" style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
          {(plan.loans ?? []).map((loan) => (
            <li key={`${loan.type}-${loan.name}-${loan.balance}`}>
              {loan.name}: {money(plan.currency, loan.balance)}
              {Number(loan.emi) > 0 ? `, EMI ${money(plan.currency, loan.emi)}` : ''}
              {Number(loan.rate) > 0 ? `, ${rate(loan.rate)} a year` : ''}
            </li>
          ))}
        </ul>
      )}
    </LShell>
  );
}
