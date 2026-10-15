'use client';

/**
 * Spare cash (REDESIGN R5.4, Windfall rev 3): a bonus, a refund, or
 * savings sitting idle, split across the emergency fund, the loans and
 * the goals with one slider each.
 *
 *   ENGINE PICK: the emergency fund gets the plan's share (the /plan
 *   split) up to its gap; the rest goes where the engine says, loan after
 *   loan in the plan's payoff order, or to an investment when that beats
 *   every loan. Goals get nothing here: paying debt first is the plan.
 *   MY SPLIT: every slider moves; the pool caps them.
 *
 * Each debt slider shows what its amount alone does to the debt-free
 * date; the KPIs run the plan once with the whole split.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Decimal from 'decimal.js';
import {
  api,
  formatCurrencyWhole,
  type CashYieldResponse,
  type LoanPayload,
  type PlanRunArgs,
  type UserPayload,
} from '@/lib/api';
import type { StrategyName } from '@/lib/strategy';
import { readRulesClient, rulesForLoans, rulesOrDefault } from '@/lib/payoff-rules';
import { useCurrentProfile, useStoredProfile } from '@/lib/use-profile';
import { rollBalancesForward } from '@/lib/roll-forward';
import { applyActivityDeltas, activityDeltas } from '@/lib/activity-cookie';
import { countryMonthKey } from '@/lib/today';
import { readEfSplitClient } from '@/lib/ef-split';
import { allocateCash, type CashFunding } from '@/lib/cash-allocation';
import { commitCashChange } from '@/lib/commit-cash-change';
import { readCashEventsClient } from '@/lib/cash-events';
import { addActivityEntry, readActivityClient } from '@/lib/activity';
import { loanToUser, userDefaultCurrency } from '@/lib/currency';
import { getCountryToday, localIsoDate, monthIndexToCountryLabel } from '@/lib/today';
import { loanLabel } from '@/lib/loan-types';
import { checkReceivedDate, kpiPrefix, nextRoundNote, whereItGoesHeading, type LoggedRound } from '@/lib/windfall-log';
import { loadProfileClient } from '@/lib/user-store';
import { fundedAmount, isOpenGoal, readGoalsClient, type Goal } from '@/lib/goals';
import {
  addContribution,
  readContributionsClient,
  totalsByGoal,
} from '@/lib/goal-contributions';
import type { AmountCurrency } from '@/lib/amount';
import { Field } from '@/components/ToolPrimitives';
import {
  LAllocationBar,
  type LAllocSegment,
  LBracket,
  LChip,
  LChipRow,
  LKpi,
  LMathBlock,
  L_MONO,
  L_T,
} from '@/components/ledger/primitives';
import { LStepHead, LStepSub } from '@/components/ledger/LToolSteps';
import { useWidth } from '@/lib/use-width';
import { announce } from '@/lib/announce';
import { planEnd } from '@/lib/plan-gap';

const LOAN_WORDS: Record<string, string> = {
  credit_card: 'credit card',
  personal_loan: 'personal loan',
  home_loan: 'home loan',
  auto_loan: 'car loan',
  education_loan: 'education loan',
  gold_loan: 'gold loan',
  bnpl: 'BNPL',
};

type Kind = 'ef' | 'loan' | 'goal' | 'invest';
interface Target {
  key: string;
  kind: Kind;
  label: string;
  /** Most it can take, in the user's currency. */
  cap: number;
  rate?: number;
  /** Loan: its place in the plan's loans, how many of the user's currency
   *  one unit of the loan's currency is, its fee share, why it's closed. */
  index?: number;
  fx?: number;
  feePct?: number;
  blocked?: string;
  goal?: Goal;
  saved?: number;
  required?: number;
}
type Alloc = Record<string, number>;

interface Pick {
  alloc: Alloc;
  fees: Record<string, number>;
  reasons: { what: string; why: string }[];
  blocked: string[];
  investName: string | null;
  hold: string | null;
}

interface Run {
  /** Shown debt-free month (lib/plan-gap planEnd): null when the plan never
   *  clears or is capped (a short month past the borrowing limit). */
  month: number | null;
  /** First month the plan can't be funded (Audit C11), else null. */
  infeasibleFrom: number | null;
  interest: number;
}

const keyOf = (l: LoanPayload, i: number) => `loan:${l.id ?? `#${i}`}`;
// The lender and type ("HDFC credit card"), with the user's nickname first
// when the loan has one (live test #4).
const loanName = (l: LoanPayload) => (LOAN_WORDS[l.loan_type] ? loanLabel(l) : l.loan_type);
const sum = (a: Alloc) => Object.values(a).reduce((s, v) => s + v, 0);

/** Round 2: every tool reads its date through planEnd(), so a capped run
 *  never shows a debt-free date here when Plan shows none. */
export function runFromResponse(r: Parameters<typeof planEnd>[0] & { total_interest_paid: string }): Run {
  const end = planEnd(r);
  return { month: end.debtFreeMonth, infeasibleFrom: end.infeasibleFrom, interest: Number(r.total_interest_paid) };
}

async function runPlan(args: PlanRunArgs, strategy: StrategyName): Promise<Run> {
  return runFromResponse(await api.simulate({ ...args, strategy }));
}

function block(l: LoanPayload): string | undefined {
  if ((l.pre_emi_months_remaining ?? 0) > 0) return l.currency === 'USD' ? 'still before its first monthly payment' : 'still in its pre-EMI period';
  const n = l.prepay_lock_in_months ?? 0;
  if (n > 0) return `locked for ${n} more month${n === 1 ? '' : 's'}`;
  return undefined;
}

export function WindfallTool({
  runArgs,
  strategy,
}: {
  /** The plan's inputs; null when there's no plan to run (no loans). */
  runArgs: PlanRunArgs | null;
  strategy: StrategyName;
}) {
  const profile = useCurrentProfile();
  const baselineProfile = useStoredProfile();
  const country = profile.user.country;
  const ccy = userDefaultCurrency(country);
  const currency: AmountCurrency = ccy === 'USD' ? 'USD' : 'INR';
  const fmt = (v: number | string | Decimal) => formatCurrencyWhole(v.toString(), ccy);
  const planUser: UserPayload = profile.user;
  const [width, ref] = useWidth(900);
  const wide = width >= 640;

  const [amount, setAmount] = useState('');
  const [source, setSource] = useState<CashFunding>('external');
  const [accountName, setAccountName] = useState('');
  const [mode, setMode] = useState<'engine' | 'manual'>('engine');
  const [manual, setManual] = useState<Alloc>({});
  const [pick, setPick] = useState<Pick | null>(null);
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  // What the last log put where (live test #19): the split below then reads
  // as the next round, not as what was logged.
  const [logged, setLogged] = useState<LoggedRound | null>(null);
  // When the money came in (live test #20): the Activity entry's date.
  const todayIso = localIsoDate(getCountryToday(country));
  const [received, setReceived] = useState(todayIso);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [saved, setSaved] = useState<Record<string, number>>({});
  useEffect(() => {
    setGoals(readGoalsClient().filter(isOpenGoal));
    setSaved(totalsByGoal(readContributionsClient()));
  }, []);

  const total = Number(amount) > 0 ? Number(amount) : 0;
  const accounts = (profile.user.cash_accounts ?? []).filter((a) => a.kind !== 'fd' && (!a.currency || a.currency === ccy));
  const efGap = Math.max(0, Number(planUser.efund_target || 0) - Number(planUser.efund_balance || 0));
  const efSplit = Number(readEfSplitClient());

  // ── Targets: the fund, each open loan (dearest first), each goal ──────
  const targets = useMemo<Target[]>(() => {
    const out: Target[] = [];
    if (efGap > 0) out.push({ key: 'ef', kind: 'ef', label: 'Emergency fund', cap: efGap });
    const loans = planUser.loans
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => Number(l.outstanding) > 0)
      .sort((a, b) => Number(b.l.nominal_rate) - Number(a.l.nominal_rate));
    for (const { l, i } of loans) {
      const fx = loanToUser(1, l, country, planUser.fx_to_user_currency);
      if (fx == null) continue;
      const feePct = Number(l.prepayment_penalty_pct || 0);
      const cap = (Number(l.outstanding) * fx) / (feePct < 1 ? 1 - feePct : 1);
      out.push({ key: keyOf(l, i), kind: 'loan', label: loanName(l), cap, rate: Number(l.nominal_rate), index: i, fx, feePct, blocked: block(l) });
    }
    for (const g of goals) {
      const required = fundedAmount(g);
      const s = saved[g.id] ?? 0;
      if (required - s > 0) out.push({ key: `goal:${g.id}`, kind: 'goal', label: g.label, cap: required - s, goal: g, saved: s, required });
    }
    return out;
  }, [planUser, efGap, goals, saved, country]);

  // ── Engine pick: re-run once typing stops ─────────────────────────────
  const pickSeq = useRef(0);
  useEffect(() => {
    const seq = ++pickSeq.current;
    let live = true;
    setPick(null);
    setPicking(false);
    // Live re-test NEW-8: no figures while the date is refused (a future
    // date showed "₹66 crore interest saved" before logging was refused).
    if (!(total > 0) || received > todayIso) {
      setPick(null);
      return;
    }
    const t = setTimeout(async () => {
      setPicking(true);
      setErr(null);
      try {
        const alloc: Alloc = {};
        const fees: Record<string, number> = {};
        const reasons: Pick['reasons'] = [];
        let blocked: string[] = [];
        let investName: string | null = null;
        let hold: string | null = null;
        const ef = efGap > 0 ? Math.min(efGap, total * efSplit) : 0;
        if (ef > 0) alloc.ef = Math.round(ef);
        let rest = total - (alloc.ef ?? 0);
        // The strategy's own order: 'rules' carries the user's rules (roadmap PR E).
        let u: UserPayload = {
          ...planUser,
          loans: planUser.loans.map((l) => ({ ...l })),
          payoff_rules: rulesForLoans(rulesOrDefault(readRulesClient(), planUser.country), planUser.loans.length),
        };
        for (let n = 0; n <= u.loans.length && rest >= 1; n++) {
          if (!u.loans.some((l) => Number(l.outstanding) > 0)) break;
          const w = await api.windfall({ amount: rest.toFixed(2), user: u, marginal_rate: profile.marginalRate, strategy });
          if (w.blocked?.length) blocked = w.blocked;
          if (w.invest_instead) {
            investName = w.investment_name;
            reasons.push({ what: w.investment_name ?? 'invest', why: w.rationale });
            break;
          }
          if (w.loan_index == null) {
            hold = w.rationale;
            break;
          }
          const l = u.loans[w.loan_index];
          const k = keyOf(planUser.loans[w.loan_index], w.loan_index);
          alloc[k] = Number(w.amount);
          fees[k] = Number(w.fee ?? 0);
          reasons.push({ what: loanName(l), why: w.rationale });
          rest = Number(w.leftover);
          u = { ...u, loans: u.loans.map((x, j) => (j === w.loan_index ? { ...x, outstanding: '0' } : x)) };
        }
        // What no loan takes fills the rest of the emergency fund first,
        // then goes to the investment the engine named, else stays put.
        const efMore = Math.min(Math.max(0, efGap - (alloc.ef ?? 0)), Math.floor(rest));
        if (efMore > 0) {
          alloc.ef = (alloc.ef ?? 0) + efMore;
          rest -= efMore;
        }
        if (investName && rest >= 1) alloc.invest = Math.floor(rest);
        if (live && seq === pickSeq.current) setPick({ alloc, fees, reasons, blocked, investName, hold });
      } catch (e) {
        if (live && seq === pickSeq.current) setErr((e as Error).message);
      } finally {
        if (live && seq === pickSeq.current) setPicking(false);
      }
    }, 450);
    return () => { live = false; clearTimeout(t); };
  }, [total, planUser, efGap, efSplit, profile.marginalRate, strategy, received, todayIso]);

  const engineAlloc = pick?.alloc ?? {};
  const alloc: Alloc = mode === 'engine' ? engineAlloc : manual;
  const placed = Math.min(total, sum(alloc));
  const left = Math.max(0, total - placed);
  const feeOf = (t: Target, a: number) => (mode === 'engine' && pick?.fees[t.key] != null ? pick.fees[t.key] : a * (t.feePct ?? 0));

  function setItem(t: Target, v: number) {
    setApplied(null);
    setManual((prev) => {
      const others = sum(prev) - (prev[t.key] ?? 0);
      const cap = Math.min(t.cap, Math.max(0, total - others));
      const nv = Math.max(0, Math.min(Math.round(v * 100) / 100, cap));
      return { ...prev, [t.key]: nv };
    });
  }
  function goManual() {
    setManual({ ...engineAlloc });
    setMode('manual');
  }
  function resetEngine() {
    setMode('engine');
    setApplied(null);
  }

  // ── The plan with this split, and each debt slider on its own ─────────
  const argsWith = useMemo(
    () =>
      (a: Alloc): PlanRunArgs | null => {
        if (!runArgs) return null;
        const user = {
          ...runArgs.user,
          efund_balance: (Number(runArgs.user.efund_balance || 0) + (a.ef ?? 0)).toFixed(2),
          loans: planUser.loans.map((l, i) => {
            const t = targets.find((x) => x.key === keyOf(l, i));
            const v = a[keyOf(l, i)] ?? 0;
            if (!t || !v || !t.fx) return l;
            const principal = (v - feeOf(t, v)) / t.fx;
            return { ...l, outstanding: Math.max(0, Number(l.outstanding) - principal).toFixed(2) };
          }),
        };
        const g = runArgs.goals?.map((x) => {
          const v = a[`goal:${x.id}`] ?? 0;
          return v ? { ...x, saved_so_far: (Number(x.saved_so_far) + v).toFixed(2) } : x;
        });
        return { ...runArgs, user, goals: g };
      },
    // feeOf reads mode and pick, both listed.
    [runArgs, planUser, targets, mode, pick], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [base, setBase] = useState<Run | null>(null);
  const [after, setAfter] = useState<Run | null>(null);
  const [perLoan, setPerLoan] = useState<Record<string, Run>>({});
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!runArgs) return;
    let live = true;
    setBase(null);
    runPlan(runArgs, strategy).then(v => { if (live) setBase(v); }, () => { if (live) setBase(null); });
    return () => { live = false; };
  }, [runArgs, strategy]);
  const allocKey = JSON.stringify(alloc);
  const runSeq = useRef(0);
  useEffect(() => {
    const seq = ++runSeq.current;
    let live = true;
    setRunning(false);
    if (!runArgs || !(placed > 0)) {
      setAfter(null);
      setPerLoan({});
      return;
    }
    const t = setTimeout(async () => {
      setRunning(true);
      try {
        const debtKeys = Object.keys(alloc).filter((k) => k.startsWith('loan:') && alloc[k] > 0);
        const [whole, ...each] = await Promise.all([
          runPlan(argsWith(alloc)!, strategy),
          ...debtKeys.map((k) => runPlan(argsWith({ [k]: alloc[k] })!, strategy)),
        ]);
        if (!live || seq !== runSeq.current) return;
        setAfter(whole);
        setPerLoan(Object.fromEntries(debtKeys.map((k, i) => [k, each[i]])));
      } catch {
        if (live && seq === runSeq.current) setAfter(null);
      } finally {
        if (live && seq === runSeq.current) setRunning(false);
      }
    }, 500);
    return () => { live = false; clearTimeout(t); };
  }, [allocKey, runArgs, strategy]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where to park the emergency-fund share, against what it earns now.
  const [park, setPark] = useState<CashYieldResponse | null>(null);
  const earnsNow =
    source === 'account' ? Number(accounts.find((a) => a.name === accountName)?.apy ?? 0) || (country === 'IN' ? 0.025 : 0.005) : country === 'IN' ? 0.025 : 0.005;
  useEffect(() => {
    const ef = alloc.ef ?? 0;
    if (!(ef > 0)) {
      setPark(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api.cashYield({ idle_balance: ef.toFixed(2), current_yield: earnsNow.toFixed(4), country }).then(v => { if (live) setPark(v); }, () => { if (live) setPark(null); });
    }, 600);
    return () => { live = false; clearTimeout(t); };
  }, [alloc.ef, earnsNow, country]); // eslint-disable-line react-hooks/exhaustive-deps

  // A date before a paid loan's entered balance: that balance already has it.
  const receivedCheck = checkReceivedDate(
    received,
    todayIso,
    targets.filter((t) => t.kind === 'loan' && (alloc[t.key] ?? 0) > 0).map((t) => planUser.loans[t.index!]?.balance_as_of),
  );
  const receivedWarning = receivedCheck.ok ? receivedCheck.warning ?? null : receivedCheck.error;

  // ── Log it ─────────────────────────────────────────────────────────────
  function logIt() {
    if (applied) return;
    setErr(null);
    try {
      if (!(placed > 0)) throw new Error('Place some of it first.');
      if (source === 'account' && accounts.length > 0 && !accountName) throw new Error('Choose the account it comes from.');
      const stored = loadProfileClient();
      if (JSON.stringify(stored.user) !== JSON.stringify(baselineProfile.user)) throw new Error('Your profile changed. Reload and check the split again.');
      if (sum(alloc) > total + 0.001) throw new Error('The split exceeds the available cash. Adjust it first.');
      if (mode === 'engine' && (!pick || picking)) throw new Error('Wait for the current split before logging it.');
      const currentMonth = countryMonthKey(stored.user.country);
      const currentLoans = applyActivityDeltas(rollBalancesForward(stored.user.loans, currentMonth).loans,
        activityDeltas(readActivityClient(), stored.user.loans, stored.user.country), currentMonth).loans;
      const dateCheck = checkReceivedDate(received, todayIso);
      if (!dateCheck.ok) throw new Error(dateCheck.error);
      const date = received;
      let entries = readActivityClient();
      let debt = 0;
      const lines: string[] = [];
      for (const t of targets) {
        const v = alloc[t.key] ?? 0;
        if (!(v > 0) || t.kind !== 'loan') continue;
        const planLoan = planUser.loans[t.index!];
        const index = planLoan.id ? stored.user.loans.findIndex((l) => l.id === planLoan.id) : t.index!;
        const loan = stored.user.loans[index];
        if (!loan) throw new Error(`${t.label} is no longer in your profile. Reload and try again.`);
        if (Number(currentLoans[index].outstanding) <= 0 || block(currentLoans[index])) throw new Error(`${t.label} is no longer available for prepayment. Reload and try again.`);
        const currentFx = loanToUser(1, currentLoans[index], country, stored.user.fx_to_user_currency);
        if (currentFx !== t.fx || Number(currentLoans[index].prepayment_penalty_pct || 0) !== t.feePct)
          throw new Error('The exchange rate or prepayment terms changed. Check the split again.');
        const fee = feeOf(t, v);
        const principal = new Decimal(v).minus(fee).div(t.fx!);
        if (!principal.isFinite() || principal.lte(0) || principal.gt(new Decimal(currentLoans[index].outstanding).add('.005')))
          throw new Error('The payment exceeds the current loan balance. Check the split again.');
        entries = addActivityEntry(
          entries,
          {
            loanIndex: index,
            loanId: loan.id,
            kind: 'paid_extra',
            date,
            amount: principal.toFixed(2),
            scheduledEmi: '0',
            source: source === 'account' ? 'spare-cash-account' : 'spare-cash-external',
            cashDebited: source === 'account' ? v.toFixed(2) : '0',
            note: `Spare cash: ${fmt(v)} to ${t.label}${fee > 0 ? `, fee ${fmt(fee)}` : ''}; from ${source === 'account' ? accountName || 'savings' : 'new cash'}`,
          },
          stored.user.loans,
        );
        debt += v;
        lines.push(`${fmt(v)} → ${t.label}`);
      }
      const ef = alloc.ef ?? 0;
      const invest = alloc.invest ?? 0;
      const toGoals = targets.filter((t) => t.kind === 'goal' && (alloc[t.key] ?? 0) > 0);
      const goalTotal = toGoals.reduce((s,t) => s + alloc[t.key], 0);
      const liveGoals = readGoalsClient();
      const liveContributions = readContributionsClient();
      const liveSaved = totalsByGoal(liveContributions);
      for (const t of toGoals) {
        const g = liveGoals.find(g => g.id === t.goal!.id);
        if (!g || !isOpenGoal(g) || alloc[t.key] > fundedAmount(g) - (liveSaved[g.id] ?? 0) + .001)
          throw new Error('A goal changed or was funded already. Reload before logging this split.');
      }
      const user = allocateCash(stored.user, {
        total: total.toFixed(2),
        ef: ef.toFixed(2),
        debt: debt.toFixed(2),
        investment: invest.toFixed(2),
        goals: goalTotal.toFixed(2),
        source,
        accountName,
        investmentName: pick?.investName ?? 'Spare cash investment',
        date,
      });
      const cash = readCashEventsClient();
      const kept = total - debt - ef - invest - toGoals.reduce((s, t) => s + alloc[t.key], 0);
      const next = {
        ...cash,
        transfers: [
          ...(cash.transfers ?? []),
          {
            id: crypto.randomUUID(),
            date,
            amount: total.toFixed(2),
            source,
            accountName,
            note: `Debt ${debt.toFixed(2)}; EF ${ef.toFixed(2)}; goals ${(total - debt - ef - invest - kept).toFixed(2)}; investment ${invest.toFixed(2)}; kept ${kept.toFixed(2)}`,
          },
        ],
      };
      let contributions = liveContributions;
      for (const t of toGoals) contributions = addContribution(contributions, { goalId: t.goal!.id, amount: alloc[t.key].toFixed(2), date, source: 'spare cash' });
      commitCashChange(stored, user, entries, next, toGoals.length ? contributions : undefined);
      if (toGoals.length) {
        setSaved(totalsByGoal(contributions));
        lines.push(...toGoals.map((t) => `${fmt(alloc[t.key])} → ${t.label}`));
      }
      if (ef > 0) lines.unshift(`${fmt(ef)} → emergency fund`);
      if (invest > 0) lines.push(`${fmt(invest)} → ${pick?.investName ?? 'investment'}`);
      setApplied(`Logged: ${lines.join(', ')}${date !== todayIso ? `, dated ${date}` : ''}.${kept >= 1 ? ` ${fmt(kept)} stays in savings.` : ''} Home and Plan use the new balances.`);
      setLogged({ lines, amount: fmt(total), date });
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  const dm = base?.month != null && after?.month != null ? after.month - base.month : null;
  const saving = base && after ? base.interest - after.interest : null;
  // Read the result out once the plan has re-run (lib/announce).
  const spoken = after?.month != null && !running
    ? `Debt-free ${monthIndexToCountryLabel(after.month, country)}${dm != null && dm < 0 ? `, ${-dm} months sooner` : dm === 0 ? ', the same month' : ''}${saving && saving > 0 ? `; interest saved ${fmt(saving)}` : ''}.`
    : '';
  useEffect(() => {
    if (spoken) announce(spoken);
  }, [spoken]);
  const toGoals = targets.filter((t) => t.kind === 'goal').reduce((s, t) => s + (alloc[t.key] ?? 0), 0);
  const groups: { title: string; right?: string; kinds: Kind[] }[] = [
    { title: 'Emergency fund', right: `THE PLAN SENDS ${Math.round(efSplit * 100)}% HERE UNTIL IT'S FULL`, kinds: ['ef'] },
    { title: 'Debts · highest rate first', right: mode === 'engine' ? `ENGINE: ${strategy.toUpperCase()} ORDER` : undefined, kinds: ['loan'] },
    { title: 'Goals', right: '★ = SAVED FOR FIRST', kinds: ['goal'] },
  ];
  const investTarget: Target | null = pick?.investName && (alloc.invest ?? 0) > 0
    ? { key: 'invest', kind: 'invest', label: `Invest: ${pick.investName}`, cap: total }
    : null;
  const segColor = (t: Target) =>
    t.kind === 'loan' ? L_T.negative : t.kind === 'ef' ? L_T.positive : t.kind === 'invest' ? L_T.ink : t.goal?.priorityBump ? L_T.accent : '#8a8a83';
  const segments: LAllocSegment[] = [...targets, ...(investTarget ? [investTarget] : [])]
    .filter((t) => (alloc[t.key] ?? 0) > 0)
    .map((t): LAllocSegment => ({ id: t.key, label: t.label.toUpperCase(), value: alloc[t.key], amount: fmt(alloc[t.key]), color: segColor(t) }));
  if (left >= 1) segments.push({ id: 'left', label: 'KEPT', value: left, amount: fmt(left), color: L_T.ruleSoft, ink: L_T.ink });

  const box: CSSProperties = { border: `1px solid ${L_T.ink}`, padding: wide ? '18px 22px' : '14px 14px' };

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {!profile.isLive && (
        <div style={{ fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', color: L_T.muted, letterSpacing: '0.08em' }}>
          DEMO PROFILE · <a href="/onboarding"><span aria-hidden="true">[</span>SETUP →<span aria-hidden="true">]</span></a>
        </div>
      )}

      <section style={box} aria-labelledby="wf-in">
        <LStepHead no="01" id="wf-in">How much</LStepHead>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 14, alignItems: 'start' }}>
          <Field label="Amount, after tax" kind="money" currency={currency} value={amount} onChange={(v) => { setAmount(v); setManual({}); setApplied(null); setLogged(null); }} />
          <LChipRow label="Where it comes from">
            <LChip on={source === 'external'} onClick={() => setSource('external')}>
              A bonus, refund or gift
            </LChip>
            <LChip on={source === 'account'} onClick={() => setSource('account')}>
              My savings
            </LChip>
          </LChipRow>
          {/* Live re-test 2 NEW-9: the help sits outside the <label> (it was
              part of the field's name) and a refused date sets aria-invalid. */}
          <div style={{ fontSize: 'var(--fs-dense)', color: L_T.muted, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label htmlFor="wf-date">{source === 'external' ? 'Date it came in' : 'Date you moved it'}</label>
            <input
              id="wf-date"
              type="date"
              value={received}
              max={todayIso}
              onChange={(e) => { setReceived(e.target.value); setApplied(null); setLogged(null); }}
              aria-describedby="wf-date-help"
              aria-invalid={receivedCheck.ok ? undefined : true}
              style={{ fontFamily: L_MONO, fontSize: 'var(--fs-body)', padding: '7px 8px', border: `1px solid ${receivedCheck.ok ? L_T.ruleSoft : L_T.negative}`, background: L_T.paper, color: L_T.ink }}
            />
            <span id="wf-date-help" role={receivedCheck.ok ? undefined : 'alert'} style={{ fontSize: 'var(--fs-small)', lineHeight: 1.5, color: receivedCheck.ok ? undefined : L_T.negative }}>
              {receivedWarning ?? 'Activity records the payment on this date, so it counts in the right month. Change it if you paid it on a later day.'}
            </span>
          </div>
          {source === 'account' && accounts.length > 0 && (
            <label style={{ fontSize: 'var(--fs-dense)', color: L_T.muted, display: 'flex', flexDirection: 'column', gap: 4 }}>
              From the account
              <select
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                style={{ fontFamily: L_MONO, fontSize: 'var(--fs-body)', padding: '7px 8px', border: `1px solid ${L_T.ruleSoft}`, background: L_T.paper, color: L_T.ink }}
              >
                <option value="">Choose an account</option>
                {accounts.map((a) => (
                  <option key={a.name} value={a.name}>
                    {a.name} · {fmt(a.balance)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      {total > 0 && (
        <section style={{ ...box, border: `2px solid ${L_T.ink}` }} aria-labelledby="wf-out">
          <LStepHead no="02" id="wf-out" accent>
            {whereItGoesHeading(logged, fmt(total))}
          </LStepHead>
          {logged && (
            <p data-testid="wf-next-round" style={{ margin: '0 0 12px', fontSize: 'var(--fs-dense)', lineHeight: 1.6, color: L_T.ink }}>
              {nextRoundNote(logged)}
            </p>
          )}
          <div role="group" aria-label="Who splits it" style={{ display: 'inline-flex', border: `1px solid ${L_T.ink}`, marginBottom: 10, flexWrap: 'wrap' }}>
            {(
              [
                ['engine', 'ENGINE PICK · BEST'],
                ['manual', 'MY SPLIT'],
              ] as const
            ).map(([k, label], i) => (
              <button
                key={k}
                type="button"
                aria-pressed={mode === k}
                onClick={k === 'engine' ? resetEngine : goManual}
                style={{
                  fontFamily: L_MONO,
                  fontSize: 'var(--fs-label)',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  padding: '9px 14px',
                  border: 'none',
                  borderLeft: i ? `1px solid ${L_T.ink}` : 'none',
                  background: mode === k ? L_T.ink : 'transparent',
                  color: mode === k ? L_T.bg : L_T.muted,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p style={{ margin: '0 0 14px', fontSize: 'var(--fs-small)', color: L_T.muted, lineHeight: 1.6 }}>
            {mode === 'engine'
              ? 'The engine sets each slider: the emergency fund its share, the loans in your payoff order, then the rest of the fund. Choose MY SPLIT to move any of them.'
              : `Move any slider. Together they stop at ${fmt(total)}. ENGINE PICK puts the best split back.`}
          </p>

          <div style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, fontSize: 'var(--fs-small)', marginBottom: 6 }}>
              <strong>{fmt(total)} TO PLACE</strong>
              <span>
                <strong>{fmt(placed)}</strong> <span style={{ color: L_T.muted }}>PLACED · </span>
                <strong style={{ color: left >= 1 ? L_T.accent : L_T.positive }}>{fmt(left)}</strong>{' '}
                <span style={{ color: L_T.muted }}>{mode === 'engine' && pick?.hold ? 'KEPT' : 'LEFT'}</span>
              </span>
            </div>
            <div style={{ height: 8, border: `1px solid ${L_T.ink}` }}>
              <div style={{ width: `${total ? (placed / total) * 100 : 0}%`, height: '100%', background: L_T.ink }} />
            </div>
          </div>

          {picking && !pick && <div style={{ fontSize: 'var(--fs-small)', color: L_T.muted }}>Working out the best split…</div>}

          {groups.map((g) => {
            const rows = targets.filter((t) => g.kinds.includes(t.kind));
            if (!rows.length) return null;
            return (
              <div key={g.title} style={{ marginBottom: 16 }}>
                <LStepSub right={g.right}>{g.title}</LStepSub>
                {rows.map((t, i) => {
                  const v = Math.round(alloc[t.key] ?? 0);
                  const run = perLoan[t.key];
                  let badge = '';
                  let tone: string = L_T.faint;
                  if (t.kind === 'loan') {
                    if (t.blocked) badge = `CAN'T TAKE IT: ${t.blocked.toUpperCase()}`;
                    else if (v > 0 && base && run && (base.month == null || run.month == null)) {
                      // A capped or never-clearing plan has no date to compare.
                      badge = run.infeasibleFrom != null || base.infeasibleFrom != null ? 'PLAN NOT FUNDABLE AS IT STANDS' : 'NO DEBT-FREE DATE';
                    } else if (v > 0 && base && run) {
                      const m = (base.month as number) - (run.month as number);
                      badge = `DEBT-FREE ${m ? `−${m} MO` : 'SAME MONTH'} · INTEREST −${fmt(Math.max(0, base.interest - run.interest))}`;
                      tone = L_T.positive;
                    } else if (v > 0) badge = running ? 'WORKING…' : '';
                    if (v > 0 && feeOf(t, v) > 0) badge += `${badge ? ' · ' : ''}FEE ${fmt(feeOf(t, v))}`;
                  } else if (t.kind === 'goal') {
                    const now = ((t.saved! + v) / t.required!) * 100;
                    badge = `${v > 0 ? `+${Math.round((v / t.required!) * 100)}% · ` : ''}NOW ${Math.round(now)}% OF ${fmt(t.required!)}`;
                    tone = v > 0 ? L_T.accent : L_T.muted;
                  } else if (t.kind === 'ef') {
                    const bal = Number(planUser.efund_balance || 0) + v;
                    const target = Number(planUser.efund_target || 0);
                    badge = `FUND ${Math.round(Math.min(100, (bal / target) * 100))}% FULL`;
                    tone = v > 0 ? L_T.positive : L_T.muted;
                  }
                  return (
                    <AllocRow
                      key={t.key}
                      first={i === 0}
                      target={t}
                      value={v}
                      total={total}
                      step={0.01}
                      disabled={mode === 'engine' || !!t.blocked}
                      onChange={(x) => setItem(t, x)}
                      badge={badge}
                      badgeTone={tone}
                      fmt={fmt}
                    />
                  );
                })}
              </div>
            );
          })}
          {investTarget && (
            <div style={{ marginBottom: 16 }}>
              <LStepSub>Invest instead</LStepSub>
              <AllocRow first target={investTarget} value={alloc.invest ?? 0} total={total} step={0.01} disabled onChange={() => undefined} badge="EARNS MORE THAN ANY LOAN COSTS" badgeTone={L_T.positive} fmt={fmt} />
            </div>
          )}
          {targets.length === 0 && (
            <p style={{ fontSize: 'var(--fs-dense)', color: L_T.muted }}>
              No loans to pay, the emergency fund is full and no goal is waiting. Keep it, or add a goal on Goals & Tools.
            </p>
          )}

          {segments.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <LStepSub>The split</LStepSub>
              <LAllocationBar segments={segments} label="Where the spare cash goes" />
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <LKpi
              mobile={!wide}
              cols={wide ? 4 : 2}
              items={[
                {
                  l: `${kpiPrefix(logged)}DEBT-FREE`,
                  v: after?.month != null
                    ? monthIndexToCountryLabel(after.month, country).toUpperCase()
                    : after?.infeasibleFrom != null ? 'NOT FUNDABLE' : runArgs ? '—' : 'NO LOANS',
                  s: dm != null
                    ? (dm < 0 ? `${-dm} MO SOONER` : dm === 0 ? 'SAME MONTH' : `${dm} MO LATER`)
                    : after?.infeasibleFrom != null && !running
                      ? `SHORT FROM ${monthIndexToCountryLabel(after.infeasibleFrom, country).toUpperCase()}`
                      : running ? 'WORKING…' : '',
                  tone: dm != null && dm < 0 ? L_T.positive : L_T.ink,
                },
                {
                  l: `${kpiPrefix(logged)}INTEREST SAVED`,
                  v: saving != null ? fmt(Math.max(0, saving)) : '—',
                  s: 'OVER THE PLAN',
                  tone: saving && saving > 0 ? L_T.positive : L_T.ink,
                },
                { l: 'TO GOALS', v: fmt(toGoals), s: toGoals > 0 ? 'ADDED TO SAVED' : 'NONE', tone: toGoals > 0 ? L_T.accent : L_T.ink },
                {
                  l: 'KEPT',
                  v: fmt(left),
                  s: left < 1 ? 'ALL PLACED' : mode === 'engine' && targets.some((t) => t.kind === 'goal') ? 'MY SPLIT SENDS IT TO A GOAL' : 'STAYS IN SAVINGS',
                  tone: L_T.ink,
                },
              ]}
            />
          </div>
        </section>
      )}

      {total > 0 && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          {profile.isLive ? (
            <button
              type="button"
              onClick={logIt}
              disabled={!!applied || !(placed > 0)}
              style={{
                fontFamily: L_MONO,
                fontSize: 'var(--fs-label)',
                fontWeight: 700,
                letterSpacing: '0.12em',
                padding: '10px 16px',
                background: applied ? L_T.positive : L_T.ink,
                color: L_T.bg,
                border: 'none',
                cursor: applied ? 'default' : 'pointer',
              }}
            >
              <span aria-hidden="true">[ </span>{applied ? 'LOGGED ✓' : 'I DID THIS · LOG IT'}<span aria-hidden="true"> ]</span>
            </button>
          ) : (
            <LBracket href="/onboarding">SET UP YOUR PROFILE TO LOG IT</LBracket>
          )}
          {mode === 'manual' && <LBracket onClick={resetEngine}>BACK TO ENGINE PICK</LBracket>}
          {err && (
            <span role="alert" style={{ color: L_T.negative, fontSize: 'var(--fs-small)' }}>
              {err}
            </span>
          )}
          {applied && (
            <span role="status" style={{ fontSize: 'var(--fs-small)', flexBasis: '100%' }}>
              {applied} <LBracket href="/">HOME →</LBracket> <LBracket href="/activity">ACTIVITY →</LBracket>
            </span>
          )}
        </div>
      )}

      {total > 0 && (
        <LMathBlock
          rows={[
            { k: 'spare cash', v: fmt(total) },
            ...(efGap > 0
              ? [
                  {
                    k: '→ emergency fund',
                    v: fmt(alloc.ef ?? 0),
                    note:
                      mode === 'engine' && (alloc.ef ?? 0) > Math.ceil(total * efSplit)
                        ? `the plan's ${Math.round(efSplit * 100)}% share, plus what no loan takes; ${fmt(efGap)} was missing`
                        : `the plan sends ${Math.round(efSplit * 100)}% here until it's full; ${fmt(efGap)} to go`,
                  },
                ]
              : Number(planUser.efund_target || 0) > 0
                ? [{ k: 'emergency fund', v: 'full', note: 'nothing needed' }]
                : [{ k: 'emergency fund', v: 'none set', note: 'add one in Profile if you want a share kept back' }]),
            ...(park?.alert && park.best_alt_yield
              ? [{ k: '   park it at', v: park.alt_name ?? '—', note: `${(Number(park.best_alt_yield) * 100).toFixed(1)}%: ${fmt(park.annual_uplift ?? 0)} a year more than ${(earnsNow * 100).toFixed(1)}%`, tone: 'pos' as const }]
              : []),
            ...targets
              .filter((t) => t.kind === 'loan' && (alloc[t.key] ?? 0) > 0)
              .map((t) => ({
                k: `→ ${t.label}`,
                v: fmt(alloc[t.key]),
                note: `${((t.rate ?? 0) * 100).toFixed(2)}% a year${feeOf(t, alloc[t.key]) > 0 ? `; ${fmt(feeOf(t, alloc[t.key]))} prepayment fee comes out of it` : ''}`,
              })),
            ...(toGoals > 0 ? [{ k: '→ goals', v: fmt(toGoals) }] : []),
            ...((alloc.invest ?? 0) > 0 ? [{ k: `→ ${pick?.investName ?? 'investment'}`, v: fmt(alloc.invest) }] : []),
            { k: 'kept', v: fmt(left), note: left >= 1 && mode === 'engine' && pick?.hold ? pick.hold : undefined },
            ...(saving != null ? [{ k: 'interest saved', v: fmt(Math.max(0, saving)), tone: 'pos' as const, note: 'the whole plan, this split against none' }] : []),
            ...(mode === 'engine' ? (pick?.reasons ?? []).map((r) => ({ k: 'why this one', v: r.what, note: r.why })) : []),
            ...(pick?.blocked.length ? [{ k: 'passed over', v: '—', note: pick.blocked.join('; ') }] : []),
          ]}
        />
      )}
    </div>
  );
}

function AllocRow({
  target,
  value,
  total,
  step,
  disabled,
  onChange,
  badge,
  badgeTone,
  first,
  fmt,
}: {
  target: Target;
  value: number;
  total: number;
  step: number;
  disabled: boolean;
  onChange: (v: number) => void;
  badge: string;
  badgeTone: string;
  first: boolean;
  fmt: (v: number) => string;
}) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  const fill = value === 0 ? L_T.ruleSoft : target.kind === 'loan' ? L_T.negative : target.kind === 'ef' ? L_T.positive : target.kind === 'invest' ? L_T.ink : L_T.accent;
  return (
    <div style={{ padding: '12px 0', borderTop: first ? 'none' : `1px dashed ${L_T.faint}`, opacity: target.blocked ? 0.6 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, fontSize: 'var(--fs-body)', fontWeight: 700, flexWrap: 'wrap' }}>
          {target.kind === 'loan' && (
            <span style={{ fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', color: L_T.negative, border: `1px solid ${L_T.negative}`, padding: '1px 5px', letterSpacing: '0.06em' }}>
              {((target.rate ?? 0) * 100).toFixed(2)}%
            </span>
          )}
          {target.goal?.priorityBump && <span style={{ color: L_T.accent }}>★</span>}
          {target.label}
          {target.kind !== 'invest' && <span style={{ fontSize: 'var(--fs-small)', color: L_T.muted, fontWeight: 500 }}>up to {fmt(target.cap)}</span>}
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: value > 0 ? L_T.ink : L_T.faint }}>{fmt(value)}</span>
      </div>
      <div style={{ position: 'relative', height: 10, background: L_T.ruleSoft }}>
        <div style={{ position: 'absolute', height: '100%', width: `${pct}%`, background: fill }} />
        <input
          type="range"
          min={0}
          max={total}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`${target.label}: amount`}
          aria-valuetext={fmt(value)}
          style={{ position: 'absolute', top: -7, left: 0, width: '100%', height: 24, margin: 0, opacity: 0, cursor: disabled ? 'not-allowed' : 'pointer' }}
        />
        <div
          aria-hidden="true"
          style={{ position: 'absolute', top: '50%', left: `${pct}%`, width: 12, height: 16, background: disabled ? L_T.muted : L_T.ink, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', color: L_T.muted, letterSpacing: '0.1em' }}>{Math.round(pct)}% OF IT</span>
        {badge && <span style={{ fontSize: 'var(--fs-label)', fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.06em', color: badgeTone }}>▸ {badge}</span>}
      </div>
    </div>
  );
}
