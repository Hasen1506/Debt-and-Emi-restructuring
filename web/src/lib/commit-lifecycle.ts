import { loadProfileClient, saveProfileClient } from './user-store';
import {
  applyConfirmedEventWithRefresh, readLifecycleClient, removeLifecycleEvent,
  undoLifecycleInStack, updateLifecycleEvent, writeLifecycleClient,
  type LifecycleEvent, type LifecycleStatus,
} from './lifecycle-events';
import { localIsoDate, getCountryToday } from './today';

/** Persist event and profile together. A failed write restores the event
 * history before returning an error, so confirmation can safely be retried. */
export function commitLifecycle(id: string, action: LifecycleStatus | 'delete'): LifecycleEvent[] {
  const before = readLifecycleClient();
  let events = before;
  const event = events.find(e => e.id === id);
  if (!event) return events;
  const stored = loadProfileClient();
  let profile = stored;
  if (action === 'confirmed' && event.status !== 'confirmed') {
    if (event.effectiveDate > localIsoDate(getCountryToday(stored.user.country))) throw new Error('Confirm this event once it has happened.');
    if (event.kind === 'property_buy' && stored.user.loans.length >= 50) throw new Error('Your profile already has the maximum 50 loans.');
    if(event.kind === 'property_buy') {
      const loan=event.loanDraft;
      if(![loan.outstanding,loan.nominal_rate,loan.scheduled_emi].every(v=>Number.isFinite(Number(v)))
        || Number(loan.outstanding)<=0 || Number(loan.scheduled_emi)<=0 || Number(loan.nominal_rate)<0 || Number(loan.nominal_rate)>1
        || !Number.isInteger(loan.tenure_months_remaining) || loan.tenure_months_remaining<1 || loan.tenure_months_remaining>480)
        throw new Error('Enter a positive loan balance, EMI and tenure, and a valid rate before confirming this event.');
    }
    const applied = applyConfirmedEventWithRefresh(stored.user,stored.marginalRate,event);
    applied.snapshot.appliedSequence = Math.max(0,...events.map(e=>e.appliedSnapshot?.appliedSequence ?? 0)) + 1;
    profile = {...stored,user:applied.user,marginalRate:applied.marginalRate};
    events = updateLifecycleEvent(events,id,{status:action,appliedSnapshot:applied.snapshot});
  } else {
    if (event.status === 'confirmed' && action !== 'confirmed' && event.appliedSnapshot) {
      const restored = undoLifecycleInStack(stored.user,event,events);
      profile = {...stored,user:restored.user,marginalRate:restored.marginalRate};
      events = restored.events;
    }
    events = action === 'delete' ? removeLifecycleEvent(events,id)
      : updateLifecycleEvent(events,id,{status:action,...(action !== 'confirmed' ? {appliedSnapshot:undefined} : {})});
  }
  writeLifecycleClient(events,false);
  if (profile !== stored && !saveProfileClient(profile)) {
    writeLifecycleClient(before,false);
    throw new Error('The profile could not be saved. This event remains unchanged.');
  }
  void import('./server-sync').then(({syncSliceToServer})=>syncSliceToServer('lifecycle',events));
  return events;
}
