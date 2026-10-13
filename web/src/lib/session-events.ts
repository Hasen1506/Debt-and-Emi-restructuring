export const SESSION_CHANGED_EVENT = 'rightdue:session-changed';

export function notifySessionChanged(): void {
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}
