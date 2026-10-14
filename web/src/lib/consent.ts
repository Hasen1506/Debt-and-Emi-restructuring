/**
 * Consent record, web side (audit80 D2, D7, D12). The sign-in page sends
 * the notice/terms versions and the 18+ tick with the code; this module is
 * the one-tap re-consent when the notice or terms change later, and the
 * account page's device list (D21). Calls go through the same-origin
 * session proxy, like every other account call.
 */
import { NOTICE_VERSION, TERMS_VERSION } from './privacy-facts';

export const CONSENT_PATH = '/api/session/auth/consent';
export const SESSIONS_PATH = '/api/session/auth/sessions';

export interface DeviceSession {
  id: string;
  device: string;
  started_at: string | null;
  last_seen_at: string | null;
  expires_at: string | null;
  this_device: boolean;
}

async function message(res: Response, fallback: string): Promise<string> {
  try {
    const detail = (await res.json())?.detail;
    const m = typeof detail === 'string' ? detail : detail?.message;
    if (typeof m === 'string' && m.trim()) return m.slice(0, 300);
  } catch { /* not JSON */ }
  return res.status === 401 ? 'Your session has expired. Sign in again.' : fallback;
}

/** Agree to the current notice and terms (one tap, with the 18+ tick). */
export async function agreeToCurrent(ageConfirmed: boolean, fetcher: typeof fetch = fetch): Promise<void> {
  const res = await fetcher(CONSENT_PATH, {
    method: 'POST', credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notice_version: NOTICE_VERSION, terms_version: TERMS_VERSION, age_confirmed: ageConfirmed }),
  });
  if (!res.ok) throw new Error(await message(res, 'Your agreement could not be saved. Try again.'));
}

export async function listDevices(fetcher: typeof fetch = fetch): Promise<DeviceSession[]> {
  const res = await fetcher(SESSIONS_PATH, { method: 'GET', credentials: 'include', cache: 'no-store' });
  if (!res.ok) throw new Error(await message(res, 'Your devices could not be listed.'));
  return ((await res.json()) as { sessions: DeviceSession[] }).sessions;
}

export async function signOutDevice(id: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (!/^[0-9a-f]{16}$/.test(id)) throw new Error('Unknown device.');
  const res = await fetcher(`${SESSIONS_PATH}/${id}/revoke`, { method: 'POST', credentials: 'include', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (!res.ok && res.status !== 204) throw new Error(await message(res, 'That device could not be signed out.'));
}

export async function signOutEverywhere(keepThisDevice: boolean, fetcher: typeof fetch = fetch): Promise<number> {
  const res = await fetcher(`${SESSIONS_PATH}/revoke-all`, {
    method: 'POST', credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keep_this_device: keepThisDevice }),
  });
  if (!res.ok) throw new Error(await message(res, 'Your devices could not be signed out.'));
  return ((await res.json()) as { signed_out: number }).signed_out;
}
