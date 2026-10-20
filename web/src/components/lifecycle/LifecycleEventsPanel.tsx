'use client';

/**
 * Life events on Plan (REDESIGN R3.4): what's coming that changes the
 * plan from a date — a pay change, a new rate on a floating-rate loan, a
 * new loan. One row each (DATE · WHAT · STATUS · actions); the plan runs
 * every planned event from its date. Once the date has passed, IT
 * HAPPENED writes it into the profile.
 *
 * Saved in a cookie (`lib/lifecycle-events`); every change re-runs the
 * plan. Other parts of Plan open the form pre-filled by dispatching
 * `ADD_LIFE_EVENT` (the rate-reset reminder opens "new rate" for its loan).
 */
import { useEffect, useState, useTransition } from 'react';
import { smoothOrAuto } from '@/lib/motion';
import { useRouter } from 'next/navigation';
import type { UserPayload } from '@/lib/api';
import {
  readLifecycleClient,
  writeLifecycleClient,
  addLifecycleEvent,
  type LifecycleEvent,
  type LifecycleDraft,
  type LifecycleKind,
  type LifecycleStatus,
} from '@/lib/lifecycle-events';
import { commitLifecycle } from '@/lib/commit-lifecycle';
import { getCountryToday, localIsoDate } from '@/lib/today';
import { LBracket, LSectionHeader, L_T } from '@/components/ledger/primitives';
import { dayLabel, LIFE_KIND_LABEL as KIND, LifeEventForm, lifeEventSummary } from './LifeEventForm';

/** `window.dispatchEvent(new CustomEvent(ADD_LIFE_EVENT, { detail }))`
 *  opens the form; detail: `{ kind?, loanIndex? }`. */
export const ADD_LIFE_EVENT = 'rightdue:add-life-event';
/** Fired after any life-event write, so every list on the page re-reads. */
export const LIFECYCLE_CHANGED = 'rightdue:lifecycle-changed';

export function LifecycleEventsPanel({ user, configuredLoans = user.loans }: { user: UserPayload; configuredLoans?: UserPayload['loans'] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const today = localIsoDate(getCountryToday(user.country));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [events, setEvents] = useState<LifecycleEvent[]>([]);
  // The open form, keyed so each open starts fresh with its kind and loan.
  const [adding, setAdding] = useState<{ key: number; kind?: LifecycleKind; loanIndex?: number } | null>(null);

  function open(kind?: LifecycleKind, loanIndex?: number) {
    setAdding({ key: Date.now(), kind, loanIndex });
    setError('');
  }

  useEffect(() => {
    setEvents(readLifecycleClient());
    setReady(true);
    const onAdd = (e: Event) => {
      const d = (e as CustomEvent<{ kind?: LifecycleKind; loanIndex?: number }>).detail ?? {};
      open(d.kind, d.loanIndex);
      requestAnimationFrame(() =>
        document.getElementById('life-events')?.scrollIntoView({ behavior: smoothOrAuto(), block: 'start' }),
      );
    };
    window.addEventListener(ADD_LIFE_EVENT, onAdd);
    const onChanged = () => setEvents(readLifecycleClient());
    window.addEventListener(LIFECYCLE_CHANGED, onChanged);
    return () => { window.removeEventListener(ADD_LIFE_EVENT, onAdd); window.removeEventListener(LIFECYCLE_CHANGED, onChanged); };
    // `open` only sets state; re-binding on each render isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refresh(next: LifecycleEvent[]) {
    setEvents(next);
    window.dispatchEvent(new Event(LIFECYCLE_CHANGED));
    setError('');
    startTransition(() => router.refresh());
  }

  function save(d: LifecycleDraft) {
    try {
      const next = addLifecycleEvent(readLifecycleClient(), d);
      writeLifecycleClient(next);
      setAdding(null);
      refresh(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function act(id: string, action: LifecycleStatus | 'delete') {
    try {
      refresh(commitLifecycle(id, action));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!ready) return null;

  const what = (e: LifecycleEvent) => lifeEventSummary(e, user);

  return (
    <section aria-labelledby="life-events-h">
      <LSectionHeader right={!adding && <LBracket onClick={() => open()}>+ ADD AN EVENT</LBracket>}>
        <span id="life-events-h">Life events · {events.length}</span>
      </LSectionHeader>
      {error && (
        <p role="alert" style={{ color: L_T.negative, fontSize: 12, margin: '0 0 8px' }}>
          {error}
        </p>
      )}
      {events.length === 0 && !adding && (
        <p style={{ margin: 0, fontSize: 12, color: L_T.muted, lineHeight: 1.6 }}>
          A pay change, a new rate on a floating-rate loan, or a loan you&apos;re about to take: the plan uses each
          from its date.
        </p>
      )}

      {events.length > 0 && (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, borderTop: `2px solid ${L_T.ink}` }}>
          {events.map((e) => {
            const due = e.effectiveDate <= today;
            const label = KIND[e.kind];
            const status =
              e.status === 'confirmed' ? 'HAPPENED' : e.status === 'cancelled' ? 'CANCELLED' : due ? 'DUE · DID IT HAPPEN?' : 'PLANNED';
            return (
              <li
                key={e.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(96px, auto) minmax(0, 1fr)',
                  gap: '4px 14px',
                  padding: '10px 8px',
                  borderBottom: `1px dashed ${L_T.ruleSoft}`,
                  fontSize: 12,
                  opacity: e.status === 'cancelled' ? 0.6 : 1,
                }}
              >
                <span style={{ color: L_T.muted, fontSize: 11, whiteSpace: 'nowrap' }}>{dayLabel(e.effectiveDate)}</span>
                <div style={{ minWidth: 0 }}>
                  <div>
                    <strong style={{ letterSpacing: '0.08em', fontSize: 11 }}>{label}</strong> · {what(e)}
                  </div>
                  {e.note && <div style={{ color: L_T.muted, fontSize: 11, marginTop: 2 }}>{e.note}</div>}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline', marginTop: 6, fontSize: 10, letterSpacing: '0.1em' }}>
                    <span
                      style={{
                        fontWeight: 700,
                        color: e.status === 'confirmed' ? L_T.positive : e.status === 'planned' && due ? L_T.accent : L_T.muted,
                      }}
                    >
                      {status}
                    </span>
                    {e.status === 'planned' && due && (
                      <LBracket accent onClick={() => act(e.id, 'confirmed')} label={`It happened: ${label} on ${dayLabel(e.effectiveDate)}`}>
                        IT HAPPENED
                      </LBracket>
                    )}
                    {e.status === 'planned' && (
                      <LBracket onClick={() => act(e.id, 'cancelled')} label={`Cancel the ${label.toLowerCase()} on ${dayLabel(e.effectiveDate)}`}>
                        CANCEL
                      </LBracket>
                    )}
                    {e.status !== 'planned' && (
                      <LBracket onClick={() => act(e.id, 'planned')} label={`Reopen the ${label.toLowerCase()} on ${dayLabel(e.effectiveDate)}`}>
                        REOPEN
                      </LBracket>
                    )}
                    <LBracket onClick={() => act(e.id, 'delete')} label={`Delete the ${label.toLowerCase()} on ${dayLabel(e.effectiveDate)}`}>
                      DELETE
                    </LBracket>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {adding && (
        <div
          role="group"
          aria-label="New life event"
          style={{ marginTop: 10, padding: '12px 14px', borderLeft: `2px solid ${L_T.accent}`, background: L_T.paper }}
        >
          <LifeEventForm
            key={adding.key}
          user={user}
          configuredLoans={configuredLoans}
            initialKind={adding.kind}
            initialLoanIndex={adding.loanIndex}
            saveLabel="SAVE · RE-RUN THE PLAN"
            onSave={save}
            onCancel={() => setAdding(null)}
          />
        </div>
      )}
      {pending && (
        <p role="status" style={{ fontSize: 11, color: L_T.muted, margin: '8px 0 0' }}>
          Re-running the plan…
        </p>
      )}
    </section>
  );
}
