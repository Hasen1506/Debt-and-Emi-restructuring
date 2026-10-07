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

// A plain function, not `class extends Date`: Next.js re-wraps the global
// Date (node-environment-extensions/date.js) by copying only its OWN
// properties, so statics a subclass merely inherits (Date.parse, Date.UTC)
// were lost and the server-rendered plan page threw "Date.parse is not a
// function". Every static is copied over as an own property instead.
function FrozenDate(...args) {
  if (!new.target) return new RealDate(now()).toString();
  return Reflect.construct(RealDate, args.length === 0 ? [now()] : args, new.target);
}
for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(RealDate))) {
  if (key !== 'prototype' && key !== 'length' && key !== 'name') Object.defineProperty(FrozenDate, key, desc);
}
FrozenDate.now = now;
FrozenDate.prototype = RealDate.prototype;
globalThis.Date = FrozenDate;
