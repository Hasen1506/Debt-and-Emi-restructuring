/**
 * Decisions page — read-only audit log of plan-affecting choices.
 * Soft-undo available for entries within the 72-hour window. The
 * server shell loads nothing; the timeline lives in localStorage,
 * so this is a client-only route in practice.
 */

import { DecisionsClient } from './DecisionsClient';

export const dynamic = 'force-dynamic';

export default function DecisionsPage() {
  return <DecisionsClient />;
}
