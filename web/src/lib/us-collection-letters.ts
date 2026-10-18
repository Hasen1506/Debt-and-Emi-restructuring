/**
 * Round 3 part B: three US letters for a debt with a collector or a medical
 * bill, built in the browser like the hardship letter (nothing is sent to the
 * server). Linked from a loan marked "with a collection agency" on Home.
 *
 *   debt_validation  dispute + ask the collector to prove the debt: within 30
 *                    days of its first notice it must pause collecting until
 *                    it verifies (FDCPA 15 U.S.C. 1692g(b); 12 CFR 1006.34, 1006.38).
 *   cease_contact    tell a collector in writing to stop contacting you
 *                    (15 U.S.C. 1692c(c); 12 CFR 1006.6(c)).
 *   medical_bill     to a provider or its collector: itemized bill, the
 *                    financial-assistance policy, hold collections meanwhile.
 *
 * Each letter opens with a DRAFT line that forSending() (lib/distress-triage)
 * takes off before it is copied, emailed or downloaded, and the page shows the
 * "Draft — pending legal review" marker (review id letter-us-collections).
 * Blank fields keep their [brackets] so a gap is obvious before sending.
 */
export type UsCollectionKind = 'debt_validation' | 'cease_contact' | 'medical_bill';
export const US_COLLECTION_KINDS: UsCollectionKind[] = ['debt_validation', 'cease_contact', 'medical_bill'];

export const US_COLLECTION_TITLES: Record<UsCollectionKind, string> = {
  debt_validation: 'Prove the debt (validation request)',
  cease_contact: 'Stop contacting me',
  medical_bill: 'Medical bill: itemize, assist, hold',
};

export const US_COLLECTION_SUB: Record<UsCollectionKind, string> = {
  debt_validation: 'A collector says you owe it: ask them to prove it. Send within 30 days of their first notice and they must pause collecting until they do.',
  cease_contact: 'Tell a collector in writing to stop calling and writing. The debt doesn’t go away, and they can still sue.',
  medical_bill: 'To the hospital, doctor or its collector: ask for an itemized bill and financial assistance, and to hold collections meanwhile.',
};

type Field = { key: string; label: string; placeholder?: string };
const ME: Field[] = [
  { key: 'name', label: 'Your full name' },
  { key: 'address', label: 'Your mailing address' },
];
export const US_COLLECTION_FIELDS: Record<UsCollectionKind, Field[]> = {
  debt_validation: [...ME,
    { key: 'collector', label: 'Collector’s name', placeholder: 'from their letter' },
    { key: 'collectorAddress', label: 'Collector’s address' },
    { key: 'reference', label: 'Their reference or account number' },
    { key: 'noticeDate', label: 'Date of their first notice', placeholder: 'e.g. 2 October 2026' }],
  cease_contact: [...ME,
    { key: 'collector', label: 'Collector’s name' },
    { key: 'collectorAddress', label: 'Collector’s address' },
    { key: 'reference', label: 'Their reference or account number' }],
  medical_bill: [...ME,
    { key: 'provider', label: 'Hospital, doctor or collector', placeholder: 'e.g. St. Mary’s Hospital billing office' },
    { key: 'providerAddress', label: 'Their billing address' },
    { key: 'reference', label: 'Account or bill number' },
    { key: 'serviceDate', label: 'Date of the care' }],
};

/** Must be filled before sending (shown as "Still needed"). */
const MUST: Record<UsCollectionKind, string[]> = {
  debt_validation: ['name', 'address', 'collector', 'reference'],
  cease_contact: ['name', 'address', 'collector', 'reference'],
  medical_bill: ['name', 'address', 'provider', 'reference'],
};

export type UsCollectionValues = Record<string, string | undefined>;

const DRAFT_LINE = 'DRAFT — check it before sending. Not legal advice.';

function v(values: UsCollectionValues, f: Field): string {
  return (values[f.key] ?? '').trim() || `[${f.label}]`;
}

export function usCollectionLetter(kind: UsCollectionKind, values: UsCollectionValues, today = '[Today’s date]'): string {
  const get = (key: string) => v(values, US_COLLECTION_FIELDS[kind].find((f) => f.key === key)!);
  const head = [DRAFT_LINE, '', today, '', get('name'), get('address'), ''];
  if (kind === 'medical_bill') {
    return [...head, get('provider'), get('providerAddress'), '', `Re: account ${get('reference')}, care on ${get('serviceDate')}`, '',
      'To the billing office,', '',
      'I am writing about the bill for the care above. Please:',
      '1. Send me an itemized bill: each charge with its billing code and date, and what my insurance paid, adjusted or denied.',
      '2. Send me your financial assistance (charity care) policy and its application, and tell me whether I may qualify.',
      '3. Hold this bill from collections and from credit reporting while I review it, apply for assistance or appeal to my insurer.',
      '4. Tell me whether you offer a payment plan with no interest.',
      '',
      'This letter is not an agreement that the amount is correct or that I owe it. Please reply in writing at the address above.',
      '', 'Sincerely,', get('name')].join('\n');
  }
  const body = kind === 'debt_validation'
    ? [
        `I am writing about the debt in your notice dated ${get('noticeDate')}. I dispute this debt, and I ask you to verify it.`,
        '',
        'Under the Fair Debt Collection Practices Act (15 U.S.C. 1692g(b)) and Regulation F (12 CFR 1006.38), please stop collecting until you send me verification, including:',
        '- the name and address of the original creditor;',
        '- the amount you say I owe, itemized: the amount on the itemization date and every interest charge, fee, payment and credit since;',
        '- a copy of the agreement or a statement that shows the debt is mine;',
        '- that you own the debt or are collecting for its owner, and that you may collect in my state.',
        '',
        'If you report this debt to a credit bureau, report it as disputed. This letter is not an admission that I owe it.',
        'Please contact me only in writing, at the address above.',
      ]
    : [
        'I ask you to stop communicating with me about this debt (15 U.S.C. 1692c(c); 12 CFR 1006.6(c)).',
        '',
        'After you receive this letter you may contact me only to tell me that you are ending collection, or that you or the creditor may take a specific action such as a lawsuit.',
        'This letter is not an admission that I owe the debt.',
      ];
  return [...head, get('collector'), get('collectorAddress'), '', `Re: reference ${get('reference')}`, '', 'To whom it may concern,', '',
    ...body, '', 'Sincerely,', get('name')].join('\n');
}

export function usCollectionMissing(kind: UsCollectionKind, values: UsCollectionValues): string[] {
  const label = Object.fromEntries(US_COLLECTION_FIELDS[kind].map((f) => [f.key, f.label.toLowerCase()]));
  return MUST[kind].filter((k) => !(values[k] ?? '').trim()).map((k) => label[k]);
}

/** Validation: the date the 30 days end, from the day the first notice came
 *  ('YYYY-MM-DD'), or null when not given. `past` once that day has gone. */
export function validationDeadline(received: string, today: string): { by: string; past: boolean } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(received)) return null;
  const d = new Date(`${received}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 30);
  const by = d.toISOString().slice(0, 10);
  return { by, past: today > by };
}

export const US_COLLECTION_HOW: Record<UsCollectionKind, string[]> = {
  debt_validation: [
    'Send it by certified mail with return receipt (or the way their notice allows) and keep a copy.',
    'Until they send verification, they must not collect the debt. Don’t pay or agree to anything first.',
    'No answer, or they keep collecting? Complain to the CFPB (consumerfinance.gov/complaint) and your state attorney general.',
  ],
  cease_contact: [
    'Send it by certified mail with return receipt and keep a copy.',
    'Stopping contact doesn’t stop a lawsuit or credit reporting. If you’re sued, answer the court papers by their deadline.',
  ],
  medical_bill: [
    'Send it to the billing office (and the collector, if there is one) and keep a copy.',
    'Nonprofit hospitals must have a written financial assistance policy (26 U.S.C. 501(r)); ask for it even if you think you earn too much.',
    'Medical bills often charge no interest: check before paying them ahead of costlier debts.',
  ],
};

export const US_COLLECTION_SOURCES = [
  'https://www.consumerfinance.gov/rules-policy/regulations/1006/34/',
  'https://www.consumerfinance.gov/rules-policy/regulations/1006/38/',
  'https://www.consumerfinance.gov/rules-policy/regulations/1006/6/',
  'https://www.irs.gov/charities-non-profits/financial-assistance-policies-faps',
];
