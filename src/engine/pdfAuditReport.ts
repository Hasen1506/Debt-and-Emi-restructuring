import type {
  AmortizationScenarioResult,
  BorrowerIdentity,
  FormalLetter,
  LoanAuditInput,
  LoanAuditResult,
  ThemeMode,
} from './types';
import { formatDuration, formatMoney, formatPct } from './math';

export interface PdfThemePalette {
  theme: ThemeMode;
  label: string;
  fontFamily: 'helvetica' | 'courier';
  pageBg: [number, number, number];
  surfaceBg: [number, number, number];
  altRowBg: [number, number, number];
  border: [number, number, number];
  inkPrimary: [number, number, number];
  inkSecondary: [number, number, number];
  accent: [number, number, number];
  accentText: [number, number, number];
  alert: [number, number, number];
  ruledLines: boolean;
}

export const PDF_THEME_PALETTES: Record<ThemeMode, PdfThemePalette> = {
  light: {
    theme: 'light',
    label: 'Clean Light',
    fontFamily: 'helvetica',
    pageBg: [255, 255, 255],
    surfaceBg: [248, 250, 252],
    altRowBg: [241, 245, 249],
    border: [203, 213, 225],
    inkPrimary: [15, 23, 42],
    inkSecondary: [71, 85, 105],
    accent: [15, 118, 110],
    accentText: [255, 255, 255],
    alert: [185, 28, 28],
    ruledLines: false,
  },
  ledger: {
    theme: 'ledger',
    label: 'Paper Ledger',
    fontFamily: 'courier',
    pageBg: [249, 245, 235],
    surfaceBg: [255, 253, 247],
    altRowBg: [243, 236, 224],
    border: [216, 206, 184],
    inkPrimary: [28, 25, 23],
    inkSecondary: [87, 83, 78],
    accent: [20, 83, 45],
    accentText: [255, 253, 247],
    alert: [153, 27, 27],
    ruledLines: true,
  },
  dark: {
    theme: 'dark',
    label: 'Dark Slate',
    fontFamily: 'helvetica',
    pageBg: [11, 17, 32],
    surfaceBg: [15, 23, 42],
    altRowBg: [30, 41, 59],
    border: [51, 65, 85],
    inkPrimary: [248, 250, 252],
    inkSecondary: [148, 163, 184],
    accent: [13, 148, 136],
    accentText: [255, 255, 255],
    alert: [248, 113, 113],
    ruledLines: false,
  },
};

export interface AuditPdfPayload {
  fileName: string;
  referenceId: string;
  generatedDate: string;
  palette: PdfThemePalette;
  jurisdictionLabel: string;
  headerTitle: string;
  headerSubtitle: string;
  borrowerRows: [string, string][];
  benchmarkRows: [string, string, string][];
  findings: {
    classification: string;
    headline: string;
    detail: string;
    nextStep: string;
    annualImpact: string;
    citations: string[];
  }[];
  annexureRows: [string, string, string, string][];
  annexureTotalLabel: string;
  amortizationSummaryRows: [string, string, string, string, string][];
  yearlyScheduleRows: [string, string, string, string, string, string][];
  escalationDeadlines: [string, string, string][];
  letterTitle: string;
  letterRecipient: string;
  letterSubject: string;
  letterBody: string;
  checklist: string[];
}

/**
 * Pure ASCII/Latin-safe money formatter for built-in jsPDF Helvetica/Courier fonts
 * (standard Type1 PDF fonts do not include the ₹ U+20B9 glyph, so use "INR " in PDF text).
 */
export function formatPdfMoney(amount: number, country: LoanAuditInput['country']): string {
  const formatted = formatMoney(amount, country);
  return formatted.replace(/₹/g, 'Rs. ').replace(/−/g, '-');
}

function sanitizePdfText(text: string): string {
  return text
    .replace(/₹/g, 'Rs. ')
    .replace(/—/g, ' - ')
    .replace(/–/g, '-')
    .replace(/−/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/·/g, ' | ')
    .replace(/§/g, 'Sec. ');
}

export function buildAuditPdfPayload(params: {
  input: LoanAuditInput;
  audit: LoanAuditResult;
  letter: FormalLetter;
  borrower: BorrowerIdentity;
  scenarios: AmortizationScenarioResult[];
  activeScenario: AmortizationScenarioResult;
  theme: ThemeMode;
}): AuditPdfPayload {
  const { input, audit, letter, borrower, scenarios, activeScenario, theme } = params;
  const palette = PDF_THEME_PALETTES[theme] ?? PDF_THEME_PALETTES.light;
  const cleanLender = input.lenderName.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const dateStamp = borrower.sentDate || '2026-11-20';
  const refSuffix = (borrower.accountNumber || '0000').replace(/[^a-zA-Z0-9]/g, '').slice(-4) || '0000';
  const referenceId = `RD-${input.country}-${dateStamp.replace(/-/g, '')}-${refSuffix.toUpperCase()}`;

  const missed = audit.findings.find((f) => f.kind === 'missed_rate_cut');

  const borrowerRows: [string, string][] = [
    ['Borrower Name', sanitizePdfText(borrower.name.trim() || '[Borrower Full Name]')],
    ['Loan Account Number', sanitizePdfText(borrower.accountNumber.trim() || '[Loan Account Number]')],
    ['Lender / Servicer', sanitizePdfText(input.lenderName)],
    ['Benchmark & Origination', `${input.benchmark.toUpperCase()} | Originated ${input.startMonth}`],
    ['Outstanding Principal', formatPdfMoney(input.outstanding, input.country)],
    ['Scheduled EMI & Tenure', `${formatPdfMoney(input.emi, input.country)}/mo | ${input.monthsRemaining} months remaining`],
  ];

  const benchmarkRows: [string, string, string][] = [
    [
      input.country === 'IN' ? 'RBI Repo Rate at Start' : 'Fed Rate at Start',
      formatPct(audit.repoAtStart),
      'Conservative lowest rate in 2-month sanction window',
    ],
    [
      input.country === 'IN' ? 'RBI Repo Rate Today' : 'Fed Rate Today',
      formatPct(audit.repoNow),
      `Verified policy rate as of ${audit.rateAsOf}`,
    ],
    [
      'Starting Rate vs Expected Today',
      `${formatPct(input.startRate)} -> ${formatPct(audit.expectedRateNow)}`,
      'Contractual spread preserved per benchmark rules',
    ],
    [
      'Current Billed Rate',
      formatPct(input.currentRate),
      input.currentRate > audit.expectedRateNow + 0.0005
        ? `Exceeds expected rate by ${formatPct(input.currentRate - audit.expectedRateNow)}`
        : 'Aligned with policy benchmark',
    ],
    [
      'Conservative Claimable Refund',
      formatPdfMoney(audit.totalClaimableRefund, input.country),
      audit.totalClaimableRefund > 0
        ? 'Strictly quantified missed reset floor (excludes pricing gaps)'
        : 'No missed benchmark cut refund claimed',
    ],
  ];

  const findings = audit.findings.map((f) => ({
    classification: f.claimable
      ? 'CLAIMABLE REFUND'
      : f.kind === 'choice_not_offered'
        ? 'STATUTORY VIOLATION'
        : f.kind === 'pricing_gap'
          ? 'INFORMATIONAL (DO NOT CLAIM)'
          : 'DIAGNOSTIC FINDING',
    headline: sanitizePdfText(f.headline),
    detail: sanitizePdfText(f.detail),
    nextStep: sanitizePdfText(f.nextStep),
    annualImpact: f.amountThisYear > 0 ? `${formatPdfMoney(f.amountThisYear, input.country)}/yr` : '-',
    citations: f.citations.map((c) => sanitizePdfText(`${c.rule}: ${c.requirement}`)),
  }));

  const annexureRows: [string, string, string, string][] = (missed?.annexure ?? []).map((row) => [
    row.month,
    formatPct(row.expectedRate),
    formatPct(row.chargedRate),
    formatPdfMoney(row.excessAmount, input.country),
  ]);

  const amortizationSummaryRows: [string, string, string, string, string][] = scenarios.map((sc) => [
    sanitizePdfText(sc.label),
    formatPct(sc.annualRate),
    formatDuration(sc.totalMonths),
    formatPdfMoney(sc.totalInterest, input.country),
    sc.key === 'current'
      ? 'Baseline'
      : sc.interestSavedVsCurrent >= 0
        ? `Saves ${formatPdfMoney(sc.interestSavedVsCurrent, input.country)}`
        : `+${formatPdfMoney(Math.abs(sc.interestSavedVsCurrent), input.country)}`,
  ]);

  const yearlyScheduleRows: [string, string, string, string, string, string][] = activeScenario.yearly
    .slice(0, 20)
    .map((yr) => [
      yr.yearLabel,
      formatPdfMoney(yr.openingBalance, input.country),
      formatPdfMoney(yr.principalPaid, input.country),
      formatPdfMoney(yr.interestPaid, input.country),
      formatPdfMoney(yr.closingBalance, input.country),
      `${yr.principalSharePct}%`,
    ]);

  const escalationDeadlines: [string, string, string][] = letter.statutoryDeadlines.map((d) => [
    sanitizePdfText(d.label),
    d.date,
    sanitizePdfText(d.note),
  ]);

  return {
    fileName: `RightDue-Loan-Audit-${cleanLender}-${dateStamp}-${theme}.pdf`,
    referenceId,
    generatedDate: dateStamp,
    palette,
    jurisdictionLabel:
      input.country === 'IN'
        ? 'India | RBI Interest Rate & Conduct Directions (2025/2026)'
        : 'United States | RESPA Reg X (12 CFR 1024.35) & FCBA Reg Z',
    headerTitle: 'RIGHTDUE FORMAL LOAN AUDIT & ESCALATION DOSSIER',
    headerSubtitle: `Theme: ${palette.label} | Ref: ${referenceId} | Audit Date: ${dateStamp}`,
    borrowerRows,
    benchmarkRows,
    findings,
    annexureRows,
    annexureTotalLabel: formatPdfMoney(missed?.overchargedSoFar ?? 0, input.country),
    amortizationSummaryRows,
    yearlyScheduleRows,
    escalationDeadlines,
    letterTitle: sanitizePdfText(letter.title),
    letterRecipient: sanitizePdfText(letter.recipient),
    letterSubject: sanitizePdfText(letter.subject),
    letterBody: sanitizePdfText(letter.body),
    checklist: letter.selfCheck.map((s) => sanitizePdfText(s)),
  };
}

/**
 * Generates and downloads a real, multi-page, theme-styled formal PDF document client-side.
 * Never uses window.open() (iframe-safe direct Blob download via jsPDF.save()).
 */
export async function downloadLoanAuditPdf(params: {
  input: LoanAuditInput;
  audit: LoanAuditResult;
  letter: FormalLetter;
  borrower: BorrowerIdentity;
  scenarios: AmortizationScenarioResult[];
  activeScenario: AmortizationScenarioResult;
  theme: ThemeMode;
}): Promise<AuditPdfPayload> {
  const payload = buildAuditPdfPayload(params);
  const { palette } = payload;

  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 42;
  const contentWidth = pageWidth - margin * 2;

  const paintPageBackground = () => {
    doc.setFillColor(...palette.pageBg);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');
    if (palette.ruledLines) {
      doc.setDrawColor(216, 206, 184);
      doc.setLineWidth(0.35);
      for (let y = 76; y < pageHeight - 40; y += 22) {
        doc.line(margin - 8, y, pageWidth - margin + 8, y);
      }
    }
  };

  paintPageBackground();

  // Top Header Band
  doc.setFillColor(...palette.accent);
  doc.rect(0, 0, pageWidth, 68, 'F');

  doc.setFont(palette.fontFamily, 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...palette.accentText);
  doc.text(payload.headerTitle, margin, 30);

  doc.setFont(palette.fontFamily, 'normal');
  doc.setFontSize(8.5);
  doc.text(payload.headerSubtitle, margin, 46);
  doc.text(payload.jurisdictionLabel, margin, 58);

  let cursorY = 86;

  const ensureSpace = (neededHeight: number) => {
    if (cursorY + neededHeight > pageHeight - 54) {
      doc.addPage();
      paintPageBackground();
      cursorY = 48;
    }
  };

  const drawSectionHeading = (title: string) => {
    ensureSpace(34);
    doc.setFont(palette.fontFamily, 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(...palette.accent);
    doc.text(title.toUpperCase(), margin, cursorY);
    doc.setDrawColor(...palette.border);
    doc.setLineWidth(0.75);
    doc.line(margin, cursorY + 4, pageWidth - margin, cursorY + 4);
    cursorY += 16;
  };

  // Section 1: Account & Loan Summary
  drawSectionHeading('1. Account & Loan Facts');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    head: [['Field', 'Verified Value']],
    body: payload.borrowerRows,
    styles: {
      font: palette.fontFamily,
      fontSize: 8.5,
      cellPadding: 5,
      textColor: palette.inkPrimary,
      fillColor: palette.surfaceBg,
      lineColor: palette.border,
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: palette.accent,
      textColor: palette.accentText,
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: palette.altRowBg,
    },
    columnStyles: {
      0: { cellWidth: 165, fontStyle: 'bold' },
    },
  });
  cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
    ? (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18
    : cursorY + 130;

  // Section 2: Benchmark Rate Reconciliation
  drawSectionHeading('2. Policy Benchmark Reconciliation');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    head: [['Audit Metric', 'Figure', 'Regulatory Basis / Note']],
    body: payload.benchmarkRows,
    styles: {
      font: palette.fontFamily,
      fontSize: 8.5,
      cellPadding: 5,
      textColor: palette.inkPrimary,
      fillColor: palette.surfaceBg,
      lineColor: palette.border,
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: palette.accent,
      textColor: palette.accentText,
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: palette.altRowBg,
    },
    columnStyles: {
      0: { cellWidth: 155, fontStyle: 'bold' },
      1: { cellWidth: 120, fontStyle: 'bold' },
    },
  });
  cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
    ? (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18
    : cursorY + 130;

  // Section 3: Audit Findings & Citations
  drawSectionHeading('3. Audit Findings & Statutory Citations');
  for (const f of payload.findings) {
    const detailLines = doc.splitTextToSize(f.detail, contentWidth - 16);
    const nextLines = doc.splitTextToSize(`Recommended Action: ${f.nextStep}`, contentWidth - 16);
    const boxHeight = 36 + detailLines.length * 11 + nextLines.length * 11 + f.citations.length * 10;
    ensureSpace(boxHeight + 10);

    doc.setFillColor(...palette.surfaceBg);
    doc.setDrawColor(...palette.border);
    doc.setLineWidth(0.6);
    doc.roundedRect(margin, cursorY, contentWidth, boxHeight, 3, 3, 'FD');

    const isAlert = f.classification === 'CLAIMABLE REFUND' || f.classification === 'STATUTORY VIOLATION';
    doc.setFont(palette.fontFamily, 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...(isAlert ? palette.alert : palette.accent));
    doc.text(`${f.classification}${f.annualImpact !== '-' ? `   |   AT STAKE: ${f.annualImpact}` : ''}`, margin + 8, cursorY + 13);

    doc.setFontSize(9.5);
    doc.setTextColor(...palette.inkPrimary);
    doc.text(doc.splitTextToSize(f.headline, contentWidth - 16)[0] || f.headline, margin + 8, cursorY + 26);

    doc.setFont(palette.fontFamily, 'normal');
    doc.setFontSize(8.2);
    doc.setTextColor(...palette.inkSecondary);
    doc.text(detailLines, margin + 8, cursorY + 38);

    const nextY = cursorY + 40 + detailLines.length * 11;
    doc.setFont(palette.fontFamily, 'bold');
    doc.setTextColor(...palette.inkPrimary);
    doc.text(nextLines, margin + 8, nextY);

    let citeY = nextY + nextLines.length * 11 + 2;
    if (f.citations.length > 0) {
      doc.setFont(palette.fontFamily, 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...palette.inkSecondary);
      for (const c of f.citations) {
        doc.text(`- ${doc.splitTextToSize(c, contentWidth - 22)[0]}`, margin + 10, citeY);
        citeY += 10;
      }
    }

    cursorY += boxHeight + 10;
  }

  // Section 4: Month-by-Month Overcharge Annexure (if claimable)
  if (payload.annexureRows.length > 0) {
    drawSectionHeading('4. Conservative Excess Interest Annexure');
    autoTable(doc, {
      startY: cursorY,
      margin: { left: margin, right: margin },
      theme: 'grid',
      head: [['Month', 'Expected Rate', 'Charged Rate', 'Excess Interest']],
      body: [
        ...payload.annexureRows,
        ['TOTAL CLAIMABLE FLOOR', '', '', payload.annexureTotalLabel],
      ],
      styles: {
        font: palette.fontFamily,
        fontSize: 8.5,
        cellPadding: 4.5,
        textColor: palette.inkPrimary,
        fillColor: palette.surfaceBg,
        lineColor: palette.border,
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: palette.accent,
        textColor: palette.accentText,
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: palette.altRowBg,
      },
      didDrawPage: () => {},
    });
    cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
      ? (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18
      : cursorY + 140;
  }

  // Section 5: Amortization Scenario Comparison & Year-by-Year Schedule
  drawSectionHeading(`5. Repayment Scenario Comparison & Amortization (${sanitizePdfText(params.activeScenario.label)})`);
  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    head: [['Scenario', 'Rate', 'Payoff Time', 'Total Interest', 'Impact vs Current']],
    body: payload.amortizationSummaryRows,
    styles: {
      font: palette.fontFamily,
      fontSize: 8,
      cellPadding: 4.5,
      textColor: palette.inkPrimary,
      fillColor: palette.surfaceBg,
      lineColor: palette.border,
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: palette.accent,
      textColor: palette.accentText,
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: palette.altRowBg,
    },
  });
  cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
    ? (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14
    : cursorY + 110;

  ensureSpace(120);
  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    head: [['Year', 'Opening Bal', 'Principal Paid', 'Interest Paid', 'Ending Bal', 'Principal %']],
    body: payload.yearlyScheduleRows,
    styles: {
      font: palette.fontFamily,
      fontSize: 7.8,
      cellPadding: 4,
      textColor: palette.inkPrimary,
      fillColor: palette.surfaceBg,
      lineColor: palette.border,
      lineWidth: 0.45,
    },
    headStyles: {
      fillColor: palette.accent,
      textColor: palette.accentText,
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: palette.altRowBg,
    },
  });
  cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
    ? (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18
    : cursorY + 160;

  // Section 6: Escalation Deadlines & Formal Notice Draft
  doc.addPage();
  paintPageBackground();
  cursorY = 48;

  drawSectionHeading('6. Statutory Escalation Deadlines & Ready-to-Send Notice');
  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin },
    theme: 'grid',
    head: [['Milestone', 'Statutory Date', 'Regulatory Requirement']],
    body: payload.escalationDeadlines,
    styles: {
      font: palette.fontFamily,
      fontSize: 8.2,
      cellPadding: 5,
      textColor: palette.inkPrimary,
      fillColor: palette.surfaceBg,
      lineColor: palette.border,
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: palette.accent,
      textColor: palette.accentText,
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: palette.altRowBg,
    },
  });
  cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
    ? (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 16
    : cursorY + 100;

  doc.setFont(palette.fontFamily, 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...palette.inkPrimary);
  doc.text(`Notice Template: ${payload.letterTitle}`, margin, cursorY);
  cursorY += 14;

  const letterLines = doc.splitTextToSize(payload.letterBody, contentWidth - 16);
  doc.setFont(palette.fontFamily, 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...palette.inkPrimary);

  for (const line of letterLines) {
    if (cursorY > pageHeight - 54) {
      doc.addPage();
      paintPageBackground();
      cursorY = 48;
      doc.setFont(palette.fontFamily, 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...palette.inkPrimary);
    }
    doc.text(line, margin + 6, cursorY);
    cursorY += 10.5;
  }

  // Stamp footer on every page
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);
    doc.setDrawColor(...palette.border);
    doc.setLineWidth(0.5);
    doc.line(margin, pageHeight - 32, pageWidth - margin, pageHeight - 32);
    doc.setFont(palette.fontFamily, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...palette.inkSecondary);
    doc.text(
      `RightDue Borrower Audit Dossier | Ref ${payload.referenceId} | Local-first deterministic audit (not legal advice)`,
      margin,
      pageHeight - 20,
    );
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 20, { align: 'right' });
  }

  doc.save(payload.fileName);
  return payload;
}
