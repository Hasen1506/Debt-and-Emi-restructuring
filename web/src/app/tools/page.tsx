/**
 * Tools index — one row per tool, each links to the standalone route.
 *
 * Matches the ledger prototype §4.8: dashed-row table with §id · name ·
 * question · sub · [OPEN →]. A flat list of decision-tools is the cleanest possible UI; no
 * accordion, no in-place expansion, no "where did I land" confusion.
 */

import { TOOLS } from '@/lib/tools';
import { LedgerToolsIndex } from '@/components/ledger/LedgerToolsIndex';

export default function ToolsPage() {
  return (
    <>
      <h1 className="sr-only">Tools</h1>
      <LedgerToolsIndex tools={TOOLS} />
    </>
  );
}
