import Decimal from 'decimal.js';
import type { UserPayload } from './api';
import { userDefaultCurrency } from './currency';

export type CashFunding = 'external' | 'account';
export interface CashAllocation {
  total: string;
  ef: string;
  debt: string;
  investment: string;
  goals?: string;
  source: CashFunding;
  accountName?: string;
  investmentName?: string;
  date: string;
}

/** All values are in residence currency. Validate before changing any balance. */
export function allocateCash(user: UserPayload, allocation: CashAllocation): UserPayload {
  const values = [allocation.total,allocation.ef,allocation.debt,allocation.investment,allocation.goals ?? '0'].map(v => new Decimal(v));
  if (values.some(v => !v.isFinite() || v.lt(0)) || values[0].lte(0)) throw new Error('Enter finite, positive cash amounts.');
  const [total,ef,debt,investment,goals] = values;
  const used = ef.plus(debt).plus(investment).plus(goals);
  if (used.gt(total)) throw new Error('Allocation exceeds the available cash.');
  const accounts = (user.cash_accounts ?? []).map(a => ({...a}));
  if (new Set(accounts.map(a=>a.name)).size !== accounts.length) throw new Error('Give each cash account a distinct name in Setup before moving cash.');
  const own = userDefaultCurrency(user.country);
  const eligible = (a: typeof accounts[number]) => a.kind !== 'fd' && (!a.currency || a.currency === own);
  let index = accounts.findIndex(a => a.name === allocation.accountName && eligible(a));
  if (allocation.source === 'account') {
    if (accounts.length) {
      if (index < 0) throw new Error('Choose the liquid account funding this action.');
      const balance = new Decimal(accounts[index].balance);
      if (balance.lt(used)) throw new Error('That account cannot cover this allocation.');
      accounts[index].balance = balance.minus(used).toFixed(2);
    } else if (new Decimal(user.savings_balance ?? 0).lt(used)) {
      throw new Error('Savings cannot cover this allocation.');
    }
  } else {
    // New external cash was never in the entered balance. Its unused portion
    // must become tracked cash, including the case where every loan is blocked.
    const leftover = total.minus(used);
    if (leftover.gt(0)) {
      if (index < 0) index = accounts.findIndex(a => a.kind === 'checking' && eligible(a));
      if (index < 0) index = accounts.findIndex(eligible);
      if (index < 0) {
        const existing = accounts.length === 0 ? user.savings_balance ?? '0' : '0';
        let name = 'Unallocated spare cash';
        for(let suffix=2;accounts.some(a=>a.name===name);suffix++) name=`Unallocated spare cash ${suffix}`;
        index=accounts.length; accounts.push({name,kind:'checking',balance:existing,apy:'0'});
      }
      accounts[index].balance = new Decimal(accounts[index].balance).plus(leftover).toFixed(2);
    }
  }
  const savings = accounts.length
    ? accounts.reduce((sum,a) => {
        const factor = !a.currency || a.currency === own ? 1 : Number(user.fx_to_user_currency?.[a.currency]);
        if (!(factor > 0)) throw new Error('Save an exchange rate for every cash account first.');
        return sum.plus(new Decimal(a.balance).mul(factor));
      },new Decimal(0))
    : new Decimal(user.savings_balance ?? 0).plus(allocation.source === 'external' ? total.minus(used) : used.negated());
  const assets = [...(user.assets ?? [])];
  if (investment.gt(0)) assets.push({asset_type:'other', label:allocation.investmentName ?? 'Spare cash investment',
    purchase_date:allocation.date,purchase_price:investment.toFixed(2),current_market_value:investment.toFixed(2),user_marks_liquid:true});
  // Goal money remains tracked wealth, in a separate reserve rather than
  // spendable savings or investments offered for another allocation.
  if (goals.gt(0)) assets.push({asset_type:'other', label:'Goal reserve',
    purchase_date:allocation.date,purchase_price:goals.toFixed(2),current_market_value:goals.toFixed(2),user_marks_liquid:false});
  return {...user,cash_accounts:accounts,savings_balance:savings.toFixed(2),
    efund_balance:new Decimal(user.efund_balance ?? 0).plus(ef).toFixed(2),assets};
}

/** Monthly recap net: only the scheduled part is charged here when the
 * extra payment was funded externally or from a separate savings/EF bucket. */
export function recapNet(income: string, expenses: string, paid: string, interest: string, scheduled: string, source: string): Decimal {
  const [i,e,p,r,s] = [income,expenses,paid,interest,scheduled].map(v => new Decimal(v));
  if ([i,e,p,r,s].some(v => !v.isFinite() || v.lt(0))) throw new Error('Income, expenses, payments and interest must be finite, non-negative numbers.');
  return i.minus(e).minus(source === 'surplus' ? p : Decimal.min(p,s)).plus(r);
}
