import type { Country, Loan, ParsedSms, SmsKind, SpendCategory, SpendLeakSummary, UserProfile } from './types';
import { simulatePayoffPlan } from './math';

const BANK_PATTERNS: Array<{ re: RegExp; name: string }> = [
  { re: /\bhdfc\b/i, name: 'HDFC Bank' },
  { re: /\bsbi\b|state\s+bank/i, name: 'State Bank of India (SBI)' },
  { re: /\bicici\b/i, name: 'ICICI Bank' },
  { re: /\baxis\b/i, name: 'Axis Bank' },
  { re: /\bkotak\b/i, name: 'Kotak Mahindra Bank' },
  { re: /\bidfc\b/i, name: 'IDFC FIRST Bank' },
  { re: /\bchase\b/i, name: 'Chase' },
  { re: /\bamex\b|american\s+express/i, name: 'American Express' },
  { re: /\bwells\s+fargo\b/i, name: 'Wells Fargo' },
  { re: /\bbank\s+of\s+america\b|\bbofa\b/i, name: 'Bank of America' },
  { re: /\bciti\b/i, name: 'Citi' },
];

const CATEGORY_RULES: Array<{ re: RegExp; cat: SpendCategory }> = [
  { re: /swiggy|zomato|ubereats|uber\s*eats|doordash|starbucks|cafe|restaurant|pizza|mcdonald|blinkit|zepto|instamart|dining/i, cat: 'Dining & Delivery' },
  { re: /netflix|spotify|youtube|apple\.com|icloud|prime\s*video|chatgpt|openai|hotstar|adobe|subscription|membership|gym|cult\.fit/i, cat: 'Subscriptions & SaaS' },
  { re: /amazon|flipkart|myntra|ajio|nykaa|target|walmart|best\s*buy|mall|zara|nike|croma/i, cat: 'Shopping & Retail' },
  { re: /uber|ola|rapido|lyft|indigo|air\s*india|delta|makemytrip|irctc|fuel|petrol|shell|chevron/i, cat: 'Rides & Travel' },
  { re: /electricity|bescom|airtel|jio|vi\b|verizon|at&t|comcast|broadband|gas|water|insurance/i, cat: 'Utilities & Bills' },
];

function parseMoneyMatch(text: string): { amount: number | null; currency: 'INR' | 'USD' } {
  const inrMatch = text.match(/(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i);
  if (inrMatch) {
    return { amount: parseFloat(inrMatch[1].replace(/,/g, '')), currency: 'INR' };
  }
  const usdMatch = text.match(/(?:usd|\$)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i);
  if (usdMatch) {
    return { amount: parseFloat(usdMatch[1].replace(/,/g, '')), currency: 'USD' };
  }
  return { amount: null, currency: 'INR' };
}

function detectBank(text: string): string | null {
  for (const p of BANK_PATTERNS) {
    if (p.re.test(text)) return p.name;
  }
  return null;
}

function extractLast4(text: string): string | null {
  const m = text.match(/(?:xx|x{2,4}|\*{2,4}|ending(?:\s+in)?|card\s+no\.?\s*)\s*(\d{4})\b/i);
  return m ? m[1] : null;
}

function extractDate(text: string): string | null {
  const m = text.match(/\b(\d{1,2}[-/\s](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-/\s]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/i);
  return m ? m[1] : null;
}

function extractMerchant(text: string): string | null {
  const atMatch = text.match(/\b(?:at|to|info:?|vpa)\s+([A-Za-z0-9.&'\-\s]{2,32}?)(?:\s+on\b|\s+via\b|\s+ref\b|\s+avl\b|\.|\,|$)/i);
  if (atMatch) {
    return atMatch[1].trim().replace(/\s+/g, ' ');
  }
  return null;
}

function categorize(text: string, kind: SmsKind): SpendCategory {
  if (kind === 'emi_debit' || kind === 'emi_bounce' || kind === 'card_statement') return 'EMI & Debt';
  if (kind === 'credit') return 'Income';
  for (const rule of CATEGORY_RULES) {
    if (rule.re.test(text)) return rule.cat;
  }
  return 'General Spend';
}

function matchLoanId(parsed: { kind: SmsKind; bank: string | null; amount: number | null; accountLast4: string | null }, loans: Loan[]): string | null {
  if (parsed.kind === 'card_statement' || parsed.kind === 'card_spend') {
    const cards = loans.filter((l) => l.loanType === 'credit_card');
    if (parsed.accountLast4) {
      const byDigits = cards.find((c) => c.accountLast4 === parsed.accountLast4);
      if (byDigits) return byDigits.id;
    }
    if (parsed.bank) {
      const byBank = cards.find((c) => c.bank.toLowerCase().includes(parsed.bank!.toLowerCase().split(' ')[0]));
      if (byBank) return byBank.id;
    }
    if (cards.length === 1) return cards[0].id;
  }

  if (parsed.kind === 'emi_debit' || parsed.kind === 'emi_bounce') {
    const termLoans = loans.filter((l) => l.loanType !== 'credit_card');
    if (parsed.accountLast4) {
      const byDigits = termLoans.find((l) => l.accountLast4 === parsed.accountLast4);
      if (byDigits) return byDigits.id;
    }
    if (parsed.amount) {
      const byEmi = termLoans.find((l) => Math.abs(l.emi - parsed.amount!) / Math.max(1, l.emi) < 0.03);
      if (byEmi) return byEmi.id;
    }
    if (parsed.bank) {
      const byBank = termLoans.find((l) => l.bank.toLowerCase().includes(parsed.bank!.toLowerCase().split(' ')[0]));
      if (byBank) return byBank.id;
    }
  }
  return null;
}

function parseSingleSmsLine(
  line: string,
  idx: number,
  loans: Loan[],
  sourceFormat: 'sms' | 'csv' | 'xml' = 'sms',
  fallbackDate?: string | null,
  fallbackBank?: string | null,
): ParsedSms {
  const lower = line.toLowerCase();
  const bank = detectBank(line) || fallbackBank || null;
  const accountLast4 = extractLast4(line);
  const date = extractDate(line) || fallbackDate || null;

  // 1. Skip OTPs & marketing promos
  if (/\botp\b|one[\s-]time\s+password|verification\s+code|do\s+not\s+share/i.test(lower)) {
    return {
      id: `${sourceFormat}-${idx}`,
      raw: line,
      kind: 'otp',
      amount: null,
      bank,
      merchant: null,
      accountLast4,
      date,
      category: 'General Spend',
      matchedLoanId: null,
      currency: 'INR',
      sourceFormat,
    };
  }
  if (/pre[\s-]?approved|instant\s+loan\s+offer|apply\s+now|cashback\s+offer|flat\s+\d+%\s+off|congratulations/i.test(lower)) {
    return {
      id: `${sourceFormat}-${idx}`,
      raw: line,
      kind: 'promo',
      amount: null,
      bank,
      merchant: null,
      accountLast4,
      date,
      category: 'General Spend',
      matchedLoanId: null,
      currency: 'INR',
      sourceFormat,
    };
  }

  // 2. Card statement SMS (Total Due + Min Due)
  if (/(?:statement|total\s+(?:amount\s+)?due|min(?:imum)?\s+(?:amt\s+)?due)/i.test(lower)) {
    const totalMatch = line.match(/total\s+(?:amt\.?|amount)?\s*due[:\s]*(?:rs\.?|inr|₹|\$|usd)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i);
    const minMatch = line.match(/min(?:imum)?\s+(?:amt\.?|amount)?\s*due[:\s]*(?:rs\.?|inr|₹|\$|usd)?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i);
    const dueMatch = line.match(/due\s+(?:by|on|date)[:\s]*(\d{1,2}[-/\s](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-/\s]?\d{0,4}|\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    const fallbackMoney = parseMoneyMatch(line);
    const amount = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) : fallbackMoney.amount;
    const minDue = minMatch ? parseFloat(minMatch[1].replace(/,/g, '')) : null;
    const currency: 'INR' | 'USD' = /\$|usd/i.test(line) ? 'USD' : 'INR';
    const kind: SmsKind = 'card_statement';
    return {
      id: `${sourceFormat}-${idx}`,
      raw: line,
      kind,
      amount,
      minDue,
      dueDate: dueMatch ? dueMatch[1] : null,
      bank,
      merchant: 'Credit Card Statement',
      accountLast4,
      date,
      category: 'EMI & Debt',
      matchedLoanId: matchLoanId({ kind, bank, amount, accountLast4 }, loans),
      currency,
      sourceFormat,
    };
  }

  const { amount, currency } = parseMoneyMatch(line);

  // 3. EMI Bounce
  if (/(?:emi|nach|ecs|auto[\s-]?debit).*(?:bounce|return|failed|insufficient|unpaid)|(?:bounce|dishonour).*(?:emi|nach)/i.test(lower)) {
    const kind: SmsKind = 'emi_bounce';
    return {
      id: `${sourceFormat}-${idx}`,
      raw: line,
      kind,
      amount,
      bank,
      merchant: 'Bounced EMI / NACH',
      accountLast4,
      date,
      category: 'EMI & Debt',
      matchedLoanId: matchLoanId({ kind, bank, amount, accountLast4 }, loans),
      currency,
      sourceFormat,
    };
  }

  // 4. EMI / NACH / Mortgage Auto-Debit
  if (/\b(?:emi|nach|ecs|mortgage\s+payment|loan\s+repayment|auto[\s-]?pay\s+loan)\b/i.test(lower)) {
    const kind: SmsKind = 'emi_debit';
    return {
      id: `${sourceFormat}-${idx}`,
      raw: line,
      kind,
      amount,
      bank,
      merchant: 'Scheduled EMI / Loan Debit',
      accountLast4,
      date,
      category: 'EMI & Debt',
      matchedLoanId: matchLoanId({ kind, bank, amount, accountLast4 }, loans),
      currency,
      sourceFormat,
    };
  }

  // 5. Salary / Credit
  if (/\b(?:credited|salary\s+credit|direct\s+deposit|received\s+rs|received\s+\$)\b/i.test(lower) && !/spent|debited|paid/i.test(lower)) {
    return {
      id: `${sourceFormat}-${idx}`,
      raw: line,
      kind: 'credit',
      amount,
      bank,
      merchant: extractMerchant(line) || 'Income / Credit',
      accountLast4,
      date,
      category: 'Income',
      matchedLoanId: null,
      currency,
      sourceFormat,
    };
  }

  // 6. Card spend
  if (/credit\s+card|card\s+(?:xx|\*\*|ending)|amex|chase\s+sapphire/i.test(lower) && amount !== null) {
    const kind: SmsKind = 'card_spend';
    const merchant = extractMerchant(line);
    return {
      id: `${sourceFormat}-${idx}`,
      raw: line,
      kind,
      amount,
      bank,
      merchant,
      accountLast4,
      date,
      category: categorize(line, kind),
      matchedLoanId: matchLoanId({ kind, bank, amount, accountLast4 }, loans),
      currency,
      sourceFormat,
    };
  }

  // 7. UPI / Debit spend
  if (/(?:upi|debited|spent|paid|purchase|withdrawn)/i.test(lower) && amount !== null) {
    const kind: SmsKind = 'upi_debit';
    const merchant = extractMerchant(line);
    return {
      id: `${sourceFormat}-${idx}`,
      raw: line,
      kind,
      amount,
      bank,
      merchant,
      accountLast4,
      date,
      category: categorize(line, kind),
      matchedLoanId: null,
      currency,
      sourceFormat,
    };
  }

  return {
    id: `${sourceFormat}-${idx}`,
    raw: line,
    kind: 'unknown',
    amount,
    bank,
    merchant: extractMerchant(line),
    accountLast4,
    date,
    category: 'General Spend',
    matchedLoanId: null,
    currency,
    sourceFormat,
  };
}

/**
 * 100% On-Device SMS / Bank Alert Batch Parser.
 */
export function parseSmsBatch(rawText: string, loans: Loan[] = []): ParsedSms[] {
  const lines = rawText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 6);

  return lines.map((line, idx) => parseSingleSmsLine(line, idx, loans, 'sms'));
}

function unescapeXml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;|&#13;/g, ' ');
}

/**
 * Parses Android "SMS Backup & Restore" bulk XML exports containing 100s–1,000s of <sms ... /> tags.
 */
export function parseAndroidSmsXml(xmlText: string, loans: Loan[] = []): ParsedSms[] {
  const results: ParsedSms[] = [];
  const smsTagRe = /<sms\b([^>]+?)\/?>/gi;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = smsTagRe.exec(xmlText)) !== null) {
    const attrs = match[1];
    const bodyMatch = attrs.match(/\bbody="([^"]*)"/i);
    if (!bodyMatch) continue;
    const addrMatch = attrs.match(/\baddress="([^"]*)"/i);
    const dateMatch = attrs.match(/\breadable_date="([^"]*)"/i);

    const body = unescapeXml(bodyMatch[1]).trim();
    if (body.length < 6) continue;
    const senderBank = addrMatch ? detectBank(addrMatch[1]) : null;
    const readableDate = dateMatch ? dateMatch[1] : null;

    results.push(parseSingleSmsLine(body, idx, loans, 'xml', readableDate, senderBank));
    idx += 1;
  }

  return results;
}

function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

function parseNumericCell(val: string | undefined): number | null {
  if (!val) return null;
  const cleaned = val.replace(/[₹$,\s]/g, '').replace(/(?:dr|cr)$/i, '');
  if (!cleaned || cleaned === '-' || cleaned === '--') return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n !== 0 ? Math.abs(n) : null;
}

/**
 * Parses HDFC/SBI/ICICI/Axis/Chase/Amex bank & credit card statement CSV files in bulk.
 */
export function parseStatementCsv(csvText: string, loans: Loan[] = [], defaultCountry: Country = 'IN'): ParsedSms[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 3);
  if (lines.length < 2) return [];

  const headerIdx = lines.findIndex((l) =>
    /(?:date|narration|description|particulars|merchant|debit|withdrawal|amount)/i.test(l),
  );
  if (headerIdx === -1) return [];

  const headers = splitCsvLine(lines[headerIdx]).map((h) => h.toLowerCase());
  const dateCol = headers.findIndex((h) => /date/.test(h));
  const descCol = headers.findIndex((h) => /narration|description|particulars|merchant|memo|details/.test(h));
  const debitCol = headers.findIndex((h) => /debit|withdrawal|dr\b|outflow/.test(h));
  const creditCol = headers.findIndex((h) => /credit|deposit|cr\b|inflow/.test(h));
  const amountCol = headers.findIndex((h) => /^amount|txn\s*amount/.test(h));

  if (descCol === -1 && debitCol === -1 && amountCol === -1) return [];

  const currency: 'INR' | 'USD' = /\$|usd/i.test(csvText)
    ? 'USD'
    : /₹|inr|rs\.?|hdfc|sbi|icici|upi/i.test(csvText)
      ? 'INR'
      : defaultCountry === 'US'
        ? 'USD'
        : 'INR';

  const rows: ParsedSms[] = [];

  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < 2) continue;

    const date = dateCol >= 0 ? cols[dateCol] || null : null;
    const desc = descCol >= 0 ? cols[descCol] || '' : cols.join(' ');
    if (!desc.trim()) continue;

    const debit = debitCol >= 0 ? parseNumericCell(cols[debitCol]) : null;
    const credit = creditCol >= 0 ? parseNumericCell(cols[creditCol]) : null;
    const rawAmt = amountCol >= 0 ? cols[amountCol] : undefined;
    const signedAmt = rawAmt ? parseFloat(rawAmt.replace(/[₹$,\s]/g, '')) : NaN;

    let amount: number | null = null;
    let isCredit = false;
    if (debit !== null) {
      amount = debit;
    } else if (credit !== null) {
      amount = credit;
      isCredit = true;
    } else if (Number.isFinite(signedAmt) && signedAmt !== 0) {
      amount = Math.abs(signedAmt);
      isCredit = signedAmt > 0 && /salary|payroll|refund|deposit|credit/i.test(desc);
    }

    if (amount === null) continue;

    const lower = desc.toLowerCase();
    const bank = detectBank(desc);
    const accountLast4 = extractLast4(desc);

    let kind: SmsKind = 'upi_debit';
    if (isCredit) {
      kind = 'credit';
    } else if (/(?:emi|nach|ecs|mortgage|loan\s+repay)/i.test(lower)) {
      kind = /bounce|return|fail/i.test(lower) ? 'emi_bounce' : 'emi_debit';
    } else if (/card|pos|amex|sapphire|credit/i.test(lower)) {
      kind = 'card_spend';
    }

    rows.push({
      id: `csv-${i}`,
      raw: `${date ? `${date} · ` : ''}${desc}`,
      kind,
      amount,
      bank,
      merchant: desc.replace(/\s+/g, ' ').slice(0, 48),
      accountLast4,
      date,
      category: categorize(desc, kind),
      matchedLoanId: matchLoanId({ kind, bank, amount, accountLast4 }, loans),
      currency,
      sourceFormat: 'csv',
    });
  }

  return rows;
}

/**
 * Deduplicates parsed transactions across bulk uploads or repeated pastes.
 */
export function deduplicateParsedSms(rows: ParsedSms[]): ParsedSms[] {
  const seen = new Set<string>();
  const out: ParsedSms[] = [];
  for (const r of rows) {
    const key = `${r.kind}|${r.date ?? ''}|${r.amount ?? ''}|${(r.merchant ?? r.raw.slice(0, 28)).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Unified bulk ingestion auto-detector: handles Android SMS Backup XML, Bank/Card CSVs, or raw SMS/Email text.
 */
export function parseBulkInput(
  rawText: string,
  loans: Loan[] = [],
  options?: { fileName?: string; defaultCountry?: Country },
): { rows: ParsedSms[]; detectedFormat: 'xml' | 'csv' | 'sms' } {
  const trimmed = rawText.trim();
  const fileName = (options?.fileName || '').toLowerCase();
  const defaultCountry = options?.defaultCountry || 'IN';

  if (fileName.endsWith('.xml') || /<sms\b[^>]+body="/i.test(trimmed)) {
    return {
      rows: deduplicateParsedSms(parseAndroidSmsXml(trimmed, loans)),
      detectedFormat: 'xml',
    };
  }

  if (
    fileName.endsWith('.csv') ||
    (trimmed.includes(',') &&
      /^(?:date|txn\s*date|transaction\s*date|post\s*date)/im.test(trimmed.split('\n')[0] || ''))
  ) {
    const csvRows = parseStatementCsv(trimmed, loans, defaultCountry);
    if (csvRows.length > 0) {
      return {
        rows: deduplicateParsedSms(csvRows),
        detectedFormat: 'csv',
      };
    }
  }

  return {
    rows: deduplicateParsedSms(parseSmsBatch(trimmed, loans)),
    detectedFormat: 'sms',
  };
}

/**
 * Aggregates discretionary spend leaks and computes EXACT months shaved & interest saved
 * if each leak category is redirected into the user's debt payoff plan!
 */
export function computeSpendLeakImpact(parsed: ParsedSms[], profile: UserProfile): SpendLeakSummary[] {
  const spendRows = parsed.filter(
    (p) => (p.kind === 'card_spend' || p.kind === 'upi_debit') && (p.amount ?? 0) > 0,
  );
  if (spendRows.length === 0) return [];

  const grouped = new Map<SpendCategory, { total: number; count: number; merchants: Set<string> }>();
  for (const row of spendRows) {
    const existing = grouped.get(row.category) || { total: 0, count: 0, merchants: new Set<string>() };
    existing.total += row.amount || 0;
    existing.count += 1;
    if (row.merchant) existing.merchants.add(row.merchant);
    grouped.set(row.category, existing);
  }

  const baseSim = simulatePayoffPlan(profile, 'avalanche');

  return Array.from(grouped.entries())
    .map(([category, data]) => {
      const boostSim = simulatePayoffPlan(
        profile,
        'avalanche',
        baseSim.monthlyExtraToDebt + Math.round(data.total),
      );
      return {
        category,
        monthlyTotal: Math.round(data.total),
        transactionCount: data.count,
        merchants: Array.from(data.merchants).slice(0, 4),
        monthsShavedIfRedirected: Math.max(0, baseSim.debtFreeMonths - boostSim.debtFreeMonths),
        interestSavedIfRedirected: Math.max(0, baseSim.totalInterest - boostSim.totalInterest),
      };
    })
    .sort((a, b) => b.monthlyTotal - a.monthlyTotal);
}

export const SAMPLE_SMS_BATCHES: Record<Country, string> = {
  IN: `HDFC Bank: Rs 35,200.00 debited from A/c XX4821 towards HDFC Home Loan EMI via NACH on 05-Nov-26.
HDFC Bank Credit Card XX9104 Statement: Total Amt Due Rs 84,650.00, Min Amt Due Rs 7,620.00, Due by 25-Nov-26.
Rs 1,840.00 spent on HDFC Bank Credit Card XX9104 at SWIGGY INSTAMART on 12-Nov-26.
Rs 2,650.00 spent on HDFC Bank Credit Card XX9104 at ZOMATO DINING on 14-Nov-26.
Rs 1,499.00 debited via UPI from A/c XX4821 to NETFLIX INDIA on 08-Nov-26.
Rs 1,999.00 spent on HDFC Bank Credit Card XX9104 at OPENAI CHATGPT PLUS on 09-Nov-26.
Rs 5,400.00 spent on HDFC Bank Credit Card XX9104 at AMAZON PAY INDIA on 15-Nov-26.
Rs 1,180.00 debited via UPI from A/c XX4821 to UBER INDIA on 16-Nov-26.
Your OTP for HDFC Bank NetBanking is 492817. Do not share with anyone.
Congratulations! Pre-approved Instant Personal Loan offer of Rs 5,00,000 at 10.99%. Apply now!`,
  US: `Chase: Your scheduled Mortgage Payment of $2,485.00 was debited from account ending 3319 on 11/01/2026.
Chase Sapphire Credit Card ending 7742 Statement: Total Due $9,420.00, Minimum Due $278.00, Due on 11/28/2026.
$142.50 spent on Chase Credit Card ending 7742 at DOORDASH on 11/10/2026.
$186.00 spent on Chase Credit Card ending 7742 at UBER EATS on 11/12/2026.
$64.99 spent on Chase Credit Card ending 7742 at NETFLIX AND SPOTIFY on 11/06/2026.
$318.40 spent on Chase Credit Card ending 7742 at AMAZON MARKETPLACE on 11/14/2026.
$95.00 spent on Chase Credit Card ending 7742 at UBER TRIP on 11/15/2026.
Chase verification code: 881204. Never share this OTP.
Pre-approved personal loan offer up to $25,000 — apply now!`,
};

export const SAMPLE_CSV_STATEMENTS: Record<Country, string> = {
  IN: `Date,Narration,Withdrawal Amt,Deposit Amt
05-Nov-26,"NACH DR HDFC HOME LOAN EMI XX4821",35200.00,
07-Nov-26,"UPI/SWIGGY INSTAMART BENGALURU",2140.00,
09-Nov-26,"POS HDFC CARD XX9104 ZOMATO GOLD",3280.00,
11-Nov-26,"UPI/NETFLIX INDIA SUBSCRIPTION",1499.00,
13-Nov-26,"POS HDFC CARD XX9104 AMAZON PAY INDIA",6450.00,
15-Nov-26,"UPI/UBER INDIA TRIPS",1620.00,
01-Nov-26,"NEFT SALARY CREDIT ACME TECH PVT LTD",,150000.00`,
  US: `Transaction Date,Description,Debit,Credit
11/01/2026,"CHASE MORTGAGE PAYMENT AUTO-DEBIT 3319",2485.00,
11/04/2026,"DOORDASH DINING SAN FRANCISCO",164.50,
11/06/2026,"NETFLIX AND SPOTIFY SUBSCRIPTION",68.99,
11/10/2026,"AMAZON MARKETPLACE PRIME",342.15,
11/14/2026,"UBER TRIP AIRPORT",89.00,
11/01/2026,"DIRECT DEPOSIT PAYROLL",,3700.00`,
};

export const SAMPLE_ANDROID_XML: Record<Country, string> = {
  IN: `<?xml version='1.0' encoding='UTF-8'?>
<smses count="5">
  <sms address="AD-HDFCBK" readable_date="05-Nov-26" body="HDFC Bank: Rs 35,200.00 debited from A/c XX4821 towards HDFC Home Loan EMI via NACH on 05-Nov-26." />
  <sms address="AD-HDFCBK" readable_date="08-Nov-26" body="HDFC Bank Credit Card XX9104 Statement: Total Amt Due Rs 82,400.00, Min Amt Due Rs 7,410.00, Due by 25-Nov-26." />
  <sms address="VM-HDFCBK" readable_date="10-Nov-26" body="Rs 2,950.00 spent on HDFC Bank Credit Card XX9104 at SWIGGY &amp; ZOMATO on 10-Nov-26." />
  <sms address="VM-HDFCBK" readable_date="12-Nov-26" body="Rs 4,800.00 spent on HDFC Bank Credit Card XX9104 at AMAZON INDIA on 12-Nov-26." />
  <sms address="AX-HDFCBK" readable_date="13-Nov-26" body="Your OTP for HDFC NetBanking is 738192. Do not share." />
</smses>`,
  US: `<?xml version='1.0' encoding='UTF-8'?>
<smses count="4">
  <sms address="CHASE" readable_date="11/01/2026" body="Chase: Your scheduled Mortgage Payment of $2,485.00 was debited from account ending 3319 on 11/01/2026." />
  <sms address="CHASE" readable_date="11/05/2026" body="Chase Sapphire Credit Card ending 7742 Statement: Total Due $9,150.00, Minimum Due $274.00, Due on 11/28/2026." />
  <sms address="CHASE" readable_date="11/10/2026" body="$195.00 spent on Chase Credit Card ending 7742 at DOORDASH &amp; UBER EATS on 11/10/2026." />
  <sms address="CHASE" readable_date="11/11/2026" body="Chase verification code: 442910. Never share this OTP." />
</smses>`,
};
