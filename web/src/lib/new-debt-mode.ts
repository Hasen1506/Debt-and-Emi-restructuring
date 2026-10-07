/** New debt check's two modes (roadmap PR I): a loan or EMI offer, or a
 *  big purchase (merged in from /tools/purchase). */
export type NewDebtMode = 'offer' | 'purchase';

export function newDebtMode(v: string | string[] | undefined): NewDebtMode {
  return v === 'purchase' ? 'purchase' : 'offer';
}
