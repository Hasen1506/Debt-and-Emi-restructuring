/**
 * India's GST on card interest, fees and charges (18%). Read from
 * tax-tables.json, which is exported from engine/tax/gst.py, so the web and
 * the engine can't drift apart: change it there and re-export.
 */
import Decimal from 'decimal.js';
import TAX from './tax-tables.json';

export const GST_RATE_IN = new Decimal(TAX.in.gst);

/** Which charges carry Indian GST (engine/tax/gst.py GST_APPLIES, exported
 *  into tax-tables.json). Card interest yes, other loan interest no, every
 *  fee and charge yes. An unknown kind throws, so a new charge is added on purpose. */
export const GST_APPLIES: Record<string, boolean> = (TAX.in as { gst_applies?: Record<string, boolean> }).gst_applies ?? {};

export function gstApplies(kind: string): boolean {
  if (!(kind in GST_APPLIES)) throw new Error(`unknown charge kind for GST: ${kind}`);
  return GST_APPLIES[kind];
}
