export const SESSION_CHANGED_EVENT = 'finoptima:session-changed';

export function notifySessionChanged(): void {
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}
