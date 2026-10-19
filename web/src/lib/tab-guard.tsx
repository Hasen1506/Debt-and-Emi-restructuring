'use client';
/**
 * UX2 #23 two tabs. The profile lives in cookies every tab shares, so a
 * form open in one tab could save over what another tab saved a minute
 * earlier without a word.
 *  • The Profile edit form keeps profileCookieKey() as it was when the form
 *    opened and compares it before saving: changed means another tab (or
 *    the account copy from another device) saved since, and the form asks
 *    "reload or overwrite?" instead of choosing for the person.
 *    The snapshot waits until this tab's account copy has arrived. Opening
 *    ?step=loans before that used to snapshot the empty cookie, then treat
 *    the account load as another tab.
 *  • Every profile save stamps PROFILE_SAVED_KEY (lib/user-store), so other
 *    open tabs (storage event) show a banner that what they show may be old.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PROFILE_SAVED_KEY, profileCookieKey } from '@/lib/user-store';
import { lPayBtn } from '@/components/ledger/primitives';

/** True when the form still holds the blank loan and the account has balances.
 *  Saving then would wipe the loans. A form the person has edited (including
 *  clearing a loan on purpose) is not blank. */
export function formWouldEraseSavedLoans(
  saved: { outstanding?: string }[],
  form: { outstanding?: string }[],
  formReady: boolean,
): boolean {
  if (formReady) return false;
  const has = (rows: { outstanding?: string }[]) =>
    rows.some((l) => Number(String(l.outstanding ?? '').replace(/[,\s]/g, '')) > 0);
  return has(saved) && !has(form);
}

export const CHANGED_ELSEWHERE = 'Changed in another tab — reload or overwrite?';

const box = { background: 'var(--highlight-soft)', borderLeft: '3px solid var(--accent)', padding: '10px 12px', lineHeight: 1.5 } as const;

/** True when the saved profile is no longer what `openedWith` read. */
export function changedSince(openedWith: string, now: string = profileCookieKey()): boolean {
  return openedWith !== now;
}

/**
 * For the Profile edit form. Call `blocks()` at the top of the form's save:
 * true (and the question shows) when another tab saved since the form
 * opened, unless the person already chose to overwrite. `ui` is the
 * question, rendered beside the save button.
 *
 * `ready` is false while this tab is still waiting for the account copy.
 * Saving is refused then, and the snapshot is taken only once the form is
 * showing that copy, so the load itself is not "another tab".
 */
export function useProfileEditGuard(save: () => unknown, ready: boolean): { blocks: () => boolean; ui: ReactNode } {
  const openedWith = useRef<string | null>(null);
  const overwrite = useRef(false);
  const latestSave = useRef(save);
  latestSave.current = save;
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    if (!ready) {
      openedWith.current = null;
      return;
    }
    openedWith.current = profileCookieKey();
  }, [ready]);

  const blocks = () => {
    if (!ready) return true;
    if (openedWith.current === null) openedWith.current = profileCookieKey();
    if (overwrite.current || !changedSince(openedWith.current)) return false;
    setConflict(true);
    return true;
  };
  const ui = conflict ? (
    <div role="alert" data-testid="tab-conflict" style={{ ...box, margin: '12px 0' }}>
      <strong>{CHANGED_ELSEWHERE}</strong>
      <div>
        Your profile was saved somewhere else (another tab or device) after you opened this form. Reload to see
        that version (what you typed here is not kept), or overwrite it with what is in this form.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <button type="button" data-testid="tab-conflict-reload" style={lPayBtn(false)} onClick={() => window.location.reload()}>
          RELOAD
        </button>
        <button type="button" data-testid="tab-conflict-overwrite" style={lPayBtn(true)}
          onClick={() => { overwrite.current = true; setConflict(false); void latestSave.current(); }}>
          OVERWRITE WITH THIS FORM
        </button>
      </div>
    </div>
  ) : null;
  return { blocks, ui };
}

/** Any page: the profile was saved in another tab after this one loaded. */
export function OtherTabSavedNotice() {
  const [at, setAt] = useState<string | null>(null);
  useEffect(() => {
    const read = () => { try { return window.localStorage.getItem(PROFILE_SAVED_KEY); } catch { return null; } };
    let seen = read();
    const on = (e: StorageEvent) => { if (e.key === PROFILE_SAVED_KEY && e.newValue) { seen = e.newValue; setAt(e.newValue); } };
    // A browser that held back the event for a background tab: check when the tab is shown again.
    const back = () => {
      const now = read();
      if (document.visibilityState === 'visible' && now && now !== seen) { seen = now; setAt(now); }
    };
    // This tab's own save (lib/user-store stamps, then fires this) is not "another tab".
    const own = () => { seen = read(); };
    window.addEventListener('storage', on);
    window.addEventListener('rightdue:profile-changed', own);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener('storage', on);
      window.removeEventListener('rightdue:profile-changed', own);
      document.removeEventListener('visibilitychange', back);
    };
  }, []);
  if (!at) return null;
  const when = new Date(at.split('#')[0]);
  const time = Number.isNaN(when.getTime()) ? '' : ` at ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  return (
    <div role="status" data-testid="other-tab-saved" className="app-shell" style={{ ...box, margin: '8px auto 0', fontSize: 'var(--fs-dense)' }}>
      <strong>Your profile was changed in another tab{time}.</strong> What this page shows may be out of date.{' '}
      <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" data-testid="other-tab-reload" style={lPayBtn(true)} onClick={() => window.location.reload()}>RELOAD</button>
        <button type="button" style={lPayBtn(false)} onClick={() => setAt(null)}>DISMISS</button>
      </span>
    </div>
  );
}
