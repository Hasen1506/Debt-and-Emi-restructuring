/**
 * Payroll wording by country. TDS (tax deducted at source) and PF/EPF are
 * Indian payroll terms; a US profile used to read "In-hand salary
 * ($/month, after TDS + PF)" (live QA, 7 Oct).
 */
import type { Country } from './api';

export function takeHomeLabel(country: Country): string {
  return country === 'IN'
    ? 'In-hand salary (₹/month, after TDS + PF)'
    : 'Take-home pay ($/month, after tax withholding + 401(k))';
}

export function untaxedIncomeLabel(country: Country): string {
  return country === 'IN'
    ? 'Tax on non-TDS income (₹/year, optional)'
    : 'Tax on income with no withholding ($/year, optional)';
}

export function salaryDeductionsPhrase(country: Country): string {
  return country === 'IN' ? 'EPF + TDS already deducted' : 'tax withholding and 401(k) already deducted';
}

export function employerTaxPhrase(country: Country): string {
  return country === 'IN' ? 'Employer TDS already covers your salary\u2019s tax.' : 'Your paycheck withholding already covers your salary\u2019s tax.';
}
