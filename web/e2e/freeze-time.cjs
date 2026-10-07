/**
 * Preloaded into the Next.js server for the E2E run (NODE_OPTIONS=--require).
 * The plan page is rendered on the server, and "today" decides the plan's
 * first month, so the server's clock must be the test's clock. Time starts
 * at E2E_FROZEN_NOW and then moves forward normally (timers, caches and
 * timeouts keep working), so every run renders the same calendar day.
 */
const RealDate = Date;
const frozen = RealDate.parse(process.env.E2E_FROZEN_NOW || '2026-10-07T04:30:00.000Z');
const startedAt = RealDate.now();
const now = () => frozen + (RealDate.now() - startedAt);

class FrozenDate extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(now());
    else super(...args);
  }
  static now() {
    return now();
  }
}
globalThis.Date = FrozenDate;
