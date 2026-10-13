/**
 * Every technical term the app uses, in plain words (sprint G10, grill #43;
 * founder: "technical terms can exist but explanations are big").
 *
 * Rules (tests/g10-product-surface.cjs checks them):
 *  - each explanation is 30 words or fewer and doesn't use its own term
 *    as the only explanation;
 *  - a rule or rate that comes from a law or regulator names it, with both
 *    the Income-tax Act 2025 section and the 1961 one where they differ
 *    (the 2025 Act replaced the 1961 Act from 1 April 2026; sections read
 *    from https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf
 *    on 2026-10-12);
 *  - the <Term> component (components/Term.tsx) shows these on tap, and
 *    /glossary lists them all.
 */
import type { Country } from './api';

export interface GlossaryEntry {
  /** The word as it appears on screen. */
  term: string;
  /** Plain words, 30 or fewer. */
  plain: string;
  /** Only for one country; both when absent. */
  country?: Country;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  avalanche: {
    term: 'Avalanche (cheapest path)',
    plain: 'Extra money goes to the loan where it saves the most interest first, usually the highest rate. Over the whole plan this pays the least interest.',
  },
  snowball: {
    term: 'Snowball (smallest first)',
    plain: 'Extra money goes to the smallest balance first. Loans close sooner, which feels good, but you usually pay a little more interest overall.',
  },
  rules: {
    term: 'Your rules (custom)',
    plain: 'You choose the order: put one loan first, or clear small balances first. Anything your rules leave out follows the cheapest path.',
  },
  emi: {
    term: 'EMI',
    plain: 'Equated monthly instalment: the fixed amount you pay each month on a loan. Part is interest, the rest brings the balance down.',
  },
  apr: {
    term: 'APR',
    plain: 'Annual percentage rate: the yearly interest rate printed on a card or loan statement, before monthly compounding and fees are added.',
  },
  cost_a_year: {
    term: 'What it costs a year',
    plain: 'The rate after interest is added monthly (compounding), GST on card interest, and any tax break. One number per loan, so loans can be compared fairly.',
  },
  compounding: {
    term: 'Compounding',
    plain: 'Interest charged on earlier interest. When interest is added every month, a 42% yearly rate costs more than 42% over a year.',
  },
  marginal_cost: {
    term: 'What the next payment saves',
    plain: 'How much interest one more rupee or dollar paid on this loan saves from now on, after fees and any tax break it gives up.',
  },
  spare_cash: {
    term: 'Spare cash',
    plain: 'What is left each month after take-home pay covers your spending and every EMI and card minimum. The plan uses it for extra payments.',
  },
  emergency_fund: {
    term: 'Emergency fund',
    plain: 'Savings kept aside for a job loss or a large bill, usually counted in months of your spending. You choose how many months.',
  },
  minimum_due: {
    term: 'Minimum due',
    plain: 'The smallest card payment that avoids a late fee. Interest is still charged on everything you leave unpaid.',
  },
  revolving: {
    term: 'Revolving (a card balance)',
    plain: 'Carrying part of a card bill into the next month. Interest then runs on the unpaid part, and usually on new purchases too.',
  },
  floating: {
    term: 'Floating rate',
    plain: 'A rate that moves with a benchmark (in India, often the RBI repo rate) at set reset dates. A fixed rate stays the same.',
  },
  reset: {
    term: 'Reset date',
    plain: 'The date your bank re-prices a floating-rate loan to the latest benchmark. A repo cut reaches your EMI or tenure only at the next reset.',
    country: 'IN',
  },
  repo: {
    term: 'Repo rate',
    plain: 'The rate at which the Reserve Bank of India lends to banks. Many floating home loans are linked to it, so your rate follows its changes.',
    country: 'IN',
  },
  eblr: {
    term: 'EBLR / RLLR',
    plain: 'External benchmark (or repo-linked) lending rate: a loan rate set as a published benchmark, usually the repo rate, plus a fixed margin called the spread.',
    country: 'IN',
  },
  mclr: {
    term: 'MCLR',
    plain: 'Marginal cost of funds based lending rate: an older bank-set benchmark. Loans on it re-price less often and follow repo cuts more slowly.',
    country: 'IN',
  },
  spread: {
    term: 'Spread',
    plain: 'The fixed margin your bank adds on top of the benchmark. If the spread goes up at a reset, a repo cut may not lower your rate.',
    country: 'IN',
  },
  kfs: {
    term: 'KFS',
    plain: 'Key Facts Statement: the one-page summary RBI requires lenders to give before you sign, with the rate, fees and total cost.',
    country: 'IN',
  },
  prepayment_fee: {
    term: 'Prepayment fee',
    plain: 'A charge for paying a loan off early. RBI bars it on floating-rate loans to individuals for non-business purposes; fixed-rate loans may still charge one.',
    country: 'IN',
  },
  lock_in: {
    term: 'Lock-in',
    plain: 'A period after taking a loan when paying extra or closing it early is not allowed, or costs a fee. The plan pays such a loan last.',
  },
  tenure: {
    term: 'Tenure',
    plain: 'How many months are left until a loan is fully repaid at its current EMI.',
  },
  gst_on_interest: {
    term: 'GST on card interest',
    plain: 'In India, 18% GST is charged on the interest and fees a card adds, which makes carrying a balance costlier than the APR says.',
    country: 'IN',
  },
  tax_shield: {
    term: 'Tax break on a loan',
    plain: 'Interest you can deduct from taxable income, so the loan costs less after tax. In India it depends on the regime you file under.',
  },
  tax_regime: {
    term: 'Old or new tax regime',
    plain: 'India’s two ways to work out income tax. The new regime has lower rates but drops most deductions, such as home-loan interest on a self-occupied home.',
    country: 'IN',
  },
  sec_24b: {
    term: 'Home-loan interest deduction',
    plain: 'Interest on a home loan, deductible up to ₹2 lakh a year for a self-occupied home under the old regime. 2025 Act s.22; 1961 Act s.24(b).',
    country: 'IN',
  },
  sec_80c: {
    term: 'Principal deduction (80C)',
    plain: 'Home-loan principal can count towards a ₹1.5 lakh yearly deduction, shared with PF, PPF and insurance, under the old regime. 2025 Act s.123; 1961 Act s.80C.',
    country: 'IN',
  },
  sec_80e: {
    term: 'Education-loan interest deduction',
    plain: 'Interest on a higher-education loan, fully deductible for up to eight years under the old regime. 2025 Act s.129; 1961 Act s.80E.',
    country: 'IN',
  },
  ltcg: {
    term: 'Long-term capital gain',
    plain: 'Profit on something held past its holding period: 12 months for listed shares, equity funds and gold ETFs, 24 months for most else in India; a year in the US.',
  },
  indexation: {
    term: 'Indexation',
    plain: 'Raising what you paid by inflation before working out a gain. In India it remains only as an option for land or buildings bought before 23 July 2024.',
    country: 'IN',
  },
  vda: {
    term: 'Crypto tax (virtual digital asset)',
    plain: 'In India the gain is taxed at 30% plus cess however long you held it; losses can’t offset other income. 2025 Act s.194; 1961 Act s.115BBH.',
    country: 'IN',
  },
  nre_nro: {
    term: 'NRE / NRO account',
    plain: 'Indian bank accounts for non-residents. NRE holds money earned abroad, and its interest is tax-free in India; NRO holds income earned in India, taxed in India.',
    country: 'IN',
  },
  remittance_cost: {
    term: 'Remittance cost',
    plain: 'What sending money abroad costs: the bank’s or app’s fee plus the gap between its exchange rate and the market rate.',
  },
  fx_drift: {
    term: 'Exchange-rate drift',
    plain: 'An assumed yearly change in the exchange rate, for example the rupee weakening against the dollar. It changes what a loan in another currency costs you.',
  },
  standard_deduction: {
    term: 'Standard deduction (US)',
    plain: 'A flat amount US taxpayers can subtract instead of listing deductions. Mortgage interest saves tax only if your listed deductions add up to more.',
    country: 'US',
  },
  pmi: {
    term: 'PMI',
    plain: 'Private mortgage insurance: a monthly charge on many US mortgages with under 20% down. It stops once you own enough of the home.',
    country: 'US',
  },
  arm: {
    term: 'ARM',
    plain: 'Adjustable-rate mortgage: a US mortgage whose rate resets on a schedule to a market index plus a margin.',
    country: 'US',
  },
  ombudsman: {
    term: 'RBI Ombudsman',
    plain: 'A free complaint service run by the Reserve Bank of India, for when a bank hasn’t resolved your complaint within 30 days or rejected it.',
    country: 'IN',
  },
  sensitivity: {
    term: 'Range (sensitivity)',
    plain: 'How the debt-free date moves if rates, income or spending change from what you entered. A range is more honest than one exact month.',
  },
};

/** The entries that apply in one country, in the order above. */
export function glossaryFor(country: Country): Array<[string, GlossaryEntry]> {
  return Object.entries(GLOSSARY).filter(([, e]) => !e.country || e.country === country);
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}
