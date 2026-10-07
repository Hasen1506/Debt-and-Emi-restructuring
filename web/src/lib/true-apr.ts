/**
 * True annual cost of a loan (roadmap PR C): the TypeScript twin of
 * engine/true_apr.py. Same algorithm, same floating-point steps, checked
 * against the engine through engine/tests/fixtures/true_apr_cases.json.
 *
 * IRR of what you receive (principal less the processing fee and its GST)
 * against what you pay each month (EMI, GST on interest, insurance), less the
 * tax the interest saves, compounded monthly: (1 + i)^12 − 1.
 */
export interface TrueAprInputs {
  nominal: number;
  months: number | null;
  fee_rate?: number;
  insurance_rate?: number;
  gst_on_interest?: number;
  gst_on_fee?: number;
  shield?: number;
}

export interface TrueApr {
  nominal: number;
  compounding: number;
  gst: number;
  fees: number;
  tax: number;
  apr: number;
}

const annualise = (i: number) => (1 + i) ** 12 - 1;

function monthlyIrr(x: Required<TrueAprInputs>): number {
  const r = x.nominal / 12;
  if (!x.months || x.months <= 0) return r * (1 + x.gst_on_interest) * (1 - x.shield) + x.insurance_rate / 12;
  const n = Math.trunc(x.months);
  const disc = 1 - (1 + r) ** -n;
  const emi = disc === 0 ? 1 / n : r / disc;
  const flows: number[] = [];
  let bal = 1;
  for (let k = 0; k < n; k++) {
    const interest = bal * r;
    flows.push(emi + interest * x.gst_on_interest - interest * x.shield + (bal * x.insurance_rate) / 12);
    bal = bal + interest - emi;
  }
  const received = 1 - ((x.fee_rate * n) / 12) * (1 + x.gst_on_fee);
  const pv = (i: number) => {
    let total = 0;
    let d = 1;
    for (const f of flows) {
      d /= 1 + i;
      total += f * d;
    }
    return total;
  };
  let lo = -0.05;
  let hi = 1;
  for (let k = 0; k < 100; k++) {
    const mid = (lo + hi) / 2;
    if (pv(mid) > received) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const full = (x: TrueAprInputs): Required<TrueAprInputs> => ({
  nominal: x.nominal,
  months: x.months,
  fee_rate: x.fee_rate ?? 0,
  insurance_rate: x.insurance_rate ?? 0,
  gst_on_interest: x.gst_on_interest ?? 0,
  gst_on_fee: x.gst_on_fee ?? 0,
  shield: x.shield ?? 0,
});

export function trueApr(input: TrueAprInputs): TrueApr {
  const x = full(input);
  const a0 = annualise(monthlyIrr(full({ nominal: x.nominal, months: x.months })));
  const a1 = annualise(monthlyIrr(full({ nominal: x.nominal, months: x.months, fee_rate: x.fee_rate, insurance_rate: x.insurance_rate })));
  const a2 = annualise(monthlyIrr({ ...x, shield: 0 }));
  const a3 = annualise(monthlyIrr(x));
  // Steps in order: compounding, fees, GST (interest and fee), tax benefit.
  return { nominal: x.nominal, compounding: a0 - x.nominal, gst: a2 - a1, fees: a1 - a0, tax: a3 - a2, apr: a3 };
}

/**
 * The inputs for a loan, read off its effective-rate breakdown so the two
 * agree on GST, fees and the tax benefit (lib/effective-apr).
 */
export function trueAprInputsFromBreakdown(
  loan: { nominal_rate?: string; loan_type: string; tenure_months_remaining?: number | string; processing_fee_amortised?: string; insurance_premium_pct?: string },
  lines: { label: string; value: { toNumber(): number }; sign: '+' | '−' }[],
): TrueAprInputs {
  const nominal = Number(loan.nominal_rate || 0);
  const fee = Number(loan.processing_fee_amortised || 0);
  const pick = (re: RegExp) => lines.filter((l) => re.test(l.label)).reduce((s, l) => s + l.value.toNumber(), 0);
  const tax = lines.filter((l) => l.sign === '−').reduce((s, l) => s + l.value.toNumber(), 0);
  const months = loan.loan_type === 'credit_card' ? null : Number(loan.tenure_months_remaining || 0) || null;
  return {
    nominal,
    months,
    fee_rate: fee,
    insurance_rate: Number(loan.insurance_premium_pct || 0),
    gst_on_interest: nominal > 0 ? pick(/^GST on interest/) / nominal : 0,
    gst_on_fee: fee > 0 ? pick(/^GST on processing fee/) / fee : 0,
    shield: nominal > 0 ? Math.min(1, tax / nominal) : 0,
  };
}
