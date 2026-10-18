/**
 * Demo user the /plan and /tools screens consume until onboarding lands.
 * Mirrors the engine.api conftest fixture so backend + frontend agree.
 */
import type { UserPayload } from './api';

export const DEMO_USER: UserPayload = {
  country: 'IN',
  income_type: 'salaried',
  annual_income: '1800000',
  monthly_income: '150000',
  fixed_expenses: '45000',
  savings_balance: '300000',
  primary_bank: 'HDFC Bank',
  location_tier: 'urban',
  tax_regime: 'new',
  efund_balance: '150000',
  efund_target: '300000',
  loans: [
    {
      loan_type: 'home_loan',
      bank: 'HDFC Bank',
      outstanding: '3500000',
      nominal_rate: '0.0850',
      rate_type: 'floating',
      tenure_months_remaining: 180,
      scheduled_emi: '35200',
      property_use: 'self_occupied',
    },
    {
      loan_type: 'credit_card',
      bank: 'HDFC Bank',
      outstanding: '80000',
      nominal_rate: '0.42',
      rate_type: 'fixed',
      tenure_months_remaining: 0,
      scheduled_emi: '4000',
    },
  ],
  investment_options: [
    {
      name: 'Liquid fund',
      expected_return: '0.065',
      liquidity_class: 'liquid',
      is_in_pool: true,
    },
  ],
  annual_hike_rate: '0.08',
  inflation_rate: '0.046',
};

export const DEMO_MARGINAL_RATE = '0.30';
