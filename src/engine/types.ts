export type Country = 'IN' | 'US';

export type ThemeMode = 'light' | 'ledger' | 'dark';

export type LoanType =
  | 'home_loan'
  | 'credit_card'
  | 'personal_loan'
  | 'auto_loan'
  | 'education_loan'
  | 'gold_loan'
  | 'bnpl';

export type RateType = 'floating' | 'fixed';

export type RateBenchmark = 'repo' | 'mclr' | 'base_rate' | 'plr' | 'prime' | 'sofr' | 'fixed';

export type LenderType =
  | 'commercial_bank'
  | 'small_finance_bank'
  | 'hfc'
  | 'nbfc'
  | 'us_bank'
  | 'us_servicer';

export type PayoffStrategy = 'avalanche' | 'snowball' | 'minimums';

export type TaxRegimeIN = 'new' | 'old';

export interface FinancialGoal {
  id: string;
  name: string;
  targetAmount: number;
  savedSoFar: number;
  targetMonths: number; // months from today
  priority: 'essential' | 'flexible';
  enabled: boolean;
}

export interface StressScenario {
  annualHikePct: number; // 0..25 (% annual salary raise)
  hikeStartMonth: number; // 1..12 (which month from today the first annual hike takes effect)
  hikeToDebtPct: number; // 0..100 (% of each raise routed into debt)
  windfallAmount: number; // lump sum bonus / tax refund
  windfallMonth: number; // 1..24 (which month the windfall hits)
  windfallRecurring: boolean; // if true, repeats every 12 months
  expenseInflationPct: number; // 0..12 (% annual growth in living expenses)
  annualStepUpPct: number; // 0..20 (% annual step-up on extra debt payments)
  rateShockBps: number; // e.g. -50, 0, +50, +100, +150 applied to floating loans
  rateShockMonth: number; // 1..24 (month from today when floating rate shock hits)
  rateShockAction: 'extend_tenure' | 'raise_emi'; // how lender handles a rate hike
  incomeDropPct: number; // 0, 25, 50, 100 (job loss / pay cut stress)
  incomeDropStartMonth: number; // 1..12 (month when income shock starts)
  incomeDropDurationMonths: number; // 0 = permanent, or 3 / 6 / 12 months temporary shock
}

export type AmortizationScenarioKey = 'current' | 'fair_reset' | 'hike_higher_emi' | 'extra_prepay';

export interface AmortizationMonthRow {
  month: number;
  label: string;
  openingBalance: number;
  emiPaid: number;
  principalPaid: number;
  interestPaid: number;
  extraPrincipal: number;
  closingBalance: number;
  cumulativePrincipal: number;
  cumulativeInterest: number;
}

export interface AmortizationYearRow {
  year: number;
  yearLabel: string;
  openingBalance: number;
  totalPaid: number;
  principalPaid: number;
  interestPaid: number;
  extraPrincipal: number;
  closingBalance: number;
  principalSharePct: number;
}

export interface AmortizationScenarioResult {
  key: AmortizationScenarioKey;
  label: string;
  subtitle: string;
  annualRate: number;
  monthlyEmi: number;
  extraMonthly: number;
  annualStepUpPct: number;
  totalMonths: number;
  payoffDateLabel: string;
  totalInterest: number;
  totalPaid: number;
  interestSavedVsCurrent: number;
  monthsSavedVsCurrent: number;
  crossoverMonth: number | null; // first month where principalPaid > interestPaid
  negativeAmortization: boolean;
  monthly: AmortizationMonthRow[];
  yearly: AmortizationYearRow[];
}

export interface Loan {
  id: string;
  name: string;
  bank: string;
  lenderType: LenderType;
  loanType: LoanType;
  rateType: RateType;
  benchmark: RateBenchmark;
  outstanding: number;
  annualRate: number; // fraction e.g. 0.085 for 8.50%
  startRate?: number; // fraction e.g. 0.0855
  startMonth?: string; // YYYY-MM
  emi: number; // scheduled EMI or usual monthly payment for card
  monthsRemaining: number;
  accountLast4?: string;
  isSelfOccupied?: boolean; // IN Sec 24(b)
  spreadChanged?: 'no' | 'yes' | 'unsure';
  spreadDelta?: number;
  monthlyNewSpend?: number; // Credit card ongoing monthly swipe while revolving!
  lastUpdated?: string;
}

export interface UserProfile {
  country: Country;
  monthlyTakeHome: number;
  monthlyLivingSpend: number;
  emergencyFundCurrent: number;
  emergencyFundTarget: number;
  emergencySplitPct: number; // % of surplus routed to EF until target reached (0..100)
  taxRegimeIN: TaxRegimeIN;
  marginalTaxRate: number; // fraction e.g. 0.30
  extraMonthlyOverride: number | null; // null = use all spare cash after EF & goal splits
  loans: Loan[];
  goals: FinancialGoal[];
}

export type PaymentStatus = 'full' | 'partial' | 'extra' | 'unable';

export interface PaymentLogEntry {
  loanId: string;
  status: PaymentStatus;
  amountPaid: number;
  loggedAt: string;
}

export interface PaymentConsequence {
  severity: 'positive' | 'neutral' | 'warning' | 'critical';
  headline: string;
  summary: string;
  immediateFee: number;
  monthlyInterestImpact: number;
  graceRevoked: boolean;
  bureauImpact: string;
  legalTimeline?: string;
  recommendedAction: string;
}

export interface CardRevolvingAnalysis {
  loanId: string;
  loanName: string;
  balance: number;
  monthlyNewSpend: number;
  gracePeriodActive: boolean;
  minimumOnlyMonths: number;
  minimumOnlyTotalInterest: number;
  dailyInterestBleed: number;
  newSpendDayOneCostPerMonth: number;
  gstPortionAnnual: number;
  isDebtSpiral: boolean; // true if min due + new spend grows balance forever
}

export interface GoalTradeoffSummary {
  totalMonthlyGoalSinking: number;
  activeGoalCount: number;
  monthsDelayedByGoals: number;
  extraLoanInterestFromGoals: number;
  cardDebtCostIfUnfunded: number; // what funding those goals via 60%/28% credit card would cost
  netBenefitOfSinkingFund: number;
}

export interface LoanMetrics {
  loan: Loan;
  nominalApr: number;
  trueAllInApr: number;
  aprExplanation: string;
  minimumDueThisMonth: number;
  monthlyInterest: number;
  revolvingAnalysis?: CardRevolvingAnalysis;
}

export interface MonthAllocationRow {
  loanId: string;
  label: string;
  bank: string;
  loanType: LoanType;
  minimum: number;
  extra: number;
  total: number;
  trueAllInApr: number;
  isExtraTarget: boolean;
  reason: string;
}

export interface TrajectoryPoint {
  monthIndex: number;
  label: string;
  optimizedBalance: number;
  minimumsBalance: number;
  snowballBalance: number;
  cumulativeInterestOptimized: number;
  cumulativeInterestMinimums: number;
}

export interface SimulationResult {
  strategy: PayoffStrategy;
  debtFreeMonths: number;
  debtFreeDateLabel: string;
  totalInterest: number;
  totalPrincipal: number;
  minimumsInterest: number;
  minimumsMonths: number;
  snowballInterest: number;
  snowballMonths: number;
  interestSavedVsMinimums: number;
  monthsSavedVsMinimums: number;
  interestSavedVsSnowball: number;
  monthsSavedVsSnowball: number;
  monthlyIncome: number;
  monthlyLivingSpend: number;
  monthlyMandatoryDues: number;
  monthlyToGoals: number;
  monthlySpareCash: number;
  monthlyExtraToDebt: number;
  monthlyToEmergencyFund: number;
  isShortfall: boolean;
  shortfallAmount: number;
  monthOneInterest: number;
  negativeAmortizationLoans: string[];
  emergencyRunwayMonths: number;
  goalTradeoff: GoalTradeoffSummary;
  allocations: MonthAllocationRow[];
  loanMetrics: LoanMetrics[];
  trajectory: TrajectoryPoint[];
  disagreements: DisagreementInsight[];
}

export interface DisagreementInsight {
  id: string;
  title: string;
  rupeeImpact: number;
  summary: string;
  detail: string;
  severity: 'high' | 'medium' | 'info';
  actionLabel?: string;
  actionTab?: string;
}

export interface Citation {
  id: string;
  rule: string;
  requirement: string;
  clause: string;
  url: string;
  checkedOn: string;
}

export interface OverchargeMonth {
  month: string;
  expectedRate: number;
  chargedRate: number;
  excessAmount: number;
}

export interface RateMoveImpact {
  oldRate: number;
  newRate: number;
  currentEmi: number;
  newEmiSameTenure: number;
  emiDelta: number;
  currentMonths: number;
  newMonthsSameEmi: number;
  extraMonths: number;
  extraInterestIfTenureExtended: number;
  extraInterestIfEmiRaised: number;
  interestSavedByPayingDelta: number;
  negativeAmortization: boolean;
}

export interface AuditFinding {
  kind:
    | 'missed_rate_cut'
    | 'old_benchmark'
    | 'rate_rise'
    | 'choice_not_offered'
    | 'pricing_gap'
    | 'rule_not_binding'
    | 'on_track';
  claimable: boolean;
  headline: string;
  detail: string;
  rateGap: number;
  amountThisYear: number;
  overchargedSoFar: number;
  monthsOvercharged: number;
  nextStep: string;
  citations: Citation[];
  annexure?: OverchargeMonth[];
}

export interface LoanAuditInput {
  country: Country;
  lenderName: string;
  lenderType: LenderType;
  loanType: LoanType;
  benchmark: RateBenchmark;
  startMonth: string; // YYYY-MM
  startRate: number; // fraction
  currentRate: number; // fraction
  outstanding: number;
  monthsRemaining: number;
  emi: number;
  spreadChanged: 'no' | 'yes' | 'unsure';
  spreadDelta: number;
  bankActionAfterHike: 'none_yet' | 'emi_raised' | 'tenure_extended' | 'both' | 'unknown';
  choiceOffered: 'yes' | 'no' | 'unsure';
  asOfDate?: string; // YYYY-MM-DD
}

export interface LoanAuditResult {
  lenderName: string;
  eblrBound: boolean;
  repoAtStart: number;
  repoNow: number;
  expectedRateNow: number;
  rateAsOf: string;
  nextPolicyMeeting: string;
  findings: AuditFinding[];
  hikeImpact: RateMoveImpact | null;
  totalClaimableRefund: number;
  totalAnnualOverpay: number;
  newBorrowerRateLow: number | null;
}

export type LetterKind =
  | 'in_grievance'
  | 'in_internal_ombudsman'
  | 'in_rbi_ombudsman'
  | 'in_reset_choice'
  | 'in_noc_closure'
  | 'us_respa_noe'
  | 'us_fcba_dispute'
  | 'hardship_in'
  | 'hardship_us';

export interface BorrowerIdentity {
  name: string;
  accountNumber: string;
  phone: string;
  email: string;
  address: string;
  sentDate: string; // YYYY-MM-DD
  bankReplyDate?: string;
}

export interface FormalLetter {
  kind: LetterKind;
  title: string;
  recipient: string;
  subject: string;
  body: string;
  portalUrl?: string;
  statutoryDeadlines: { label: string; date: string; note: string }[];
  citations: Citation[];
  selfCheck: string[];
  hasStraySecondPerson: boolean;
}

export type SmsKind =
  | 'card_spend'
  | 'upi_debit'
  | 'emi_debit'
  | 'emi_bounce'
  | 'card_statement'
  | 'credit'
  | 'otp'
  | 'promo'
  | 'unknown';

export type SpendCategory =
  | 'Dining & Delivery'
  | 'Subscriptions & SaaS'
  | 'Shopping & Retail'
  | 'Rides & Travel'
  | 'Utilities & Bills'
  | 'EMI & Debt'
  | 'Income'
  | 'General Spend';

export interface ParsedSms {
  id: string;
  raw: string;
  kind: SmsKind;
  amount: number | null;
  minDue?: number | null;
  dueDate?: string | null;
  bank: string | null;
  merchant: string | null;
  accountLast4: string | null;
  date: string | null;
  category: SpendCategory;
  matchedLoanId: string | null;
  currency: 'INR' | 'USD';
  sourceFormat?: 'sms' | 'csv' | 'xml';
}

export interface SpendLeakSummary {
  category: SpendCategory;
  monthlyTotal: number;
  transactionCount: number;
  merchants: string[];
  monthsShavedIfRedirected: number;
  interestSavedIfRedirected: number;
}

export interface AdviceClaim {
  id: string;
  kind: string;
  quote: string;
  verdict: 'verified' | 'wrong' | 'cant_check';
  theirs: string;
  ours: string;
  why: string;
  impactAmount?: number;
  citation?: string;
}

export interface AdviceReport {
  headline: string;
  verifiedCount: number;
  wrongCount: number;
  cantCheckCount: number;
  claims: AdviceClaim[];
  notChecked: string[];
}

export interface OfferAuditInput {
  country: Country;
  kind: 'no_cost_emi' | 'personal_loan' | 'top_up' | 'card_consolidation';
  principal: number;
  quotedAnnualRate: number; // fraction
  tenureMonths: number;
  processingFeeAmount: number;
  processingFeePct: number;
  foregoneDiscount: number; // for no-cost EMI
  replacesLoanId?: string;
}

export interface OfferAuditResult {
  emi: number;
  upfrontFeesWithTax: number;
  totalInterest: number;
  totalOutflow: number;
  trueAllInApr: number;
  verdict: 'worth_it' | 'trap' | 'borderline';
  headline: string;
  explanation: string;
  emiToIncomePct: number;
  netSavingsVsCurrent: number | null;
  breakEvenMonths: number | null;
}

export interface TrackedCase {
  id: string;
  lenderName: string;
  kind: LetterKind;
  sentDate: string;
  claimAmount: number;
  status: 'sent' | 'io_escalated' | 'ombudsman_ready' | 'resolved';
  replyDueDate: string;
  escalationDeadline: string;
}
