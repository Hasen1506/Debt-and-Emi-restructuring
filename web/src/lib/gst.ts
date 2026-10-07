/**
 * India's GST on card interest, fees and charges (18%). Read from
 * tax-tables.json, which is exported from engine/tax/gst.py, so the web and
 * the engine can't drift apart: change it there and re-export.
 */
import Decimal from 'decimal.js';
import TAX from './tax-tables.json';

export const GST_RATE_IN = new Decimal(TAX.in.gst);
