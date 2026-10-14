'use client';
/**
 * Calls to /api/notify (api/notify/routes.py). Every call is same-origin
 * with the session cookie; with the server's flags off they 404 and the
 * UI stays hidden.
 */
import { browserApiBase } from './api-base';
import { pageScoped } from './page-abort';

export interface NotifyFlags { payday_email: boolean; deadline_reminders: boolean; reply_done: boolean }
export interface NotifyAnswer { id: number; kind: 'ack_all' | 'ack_some' | 'ack_cant' | 'reply_done' | 'reply_not'; month: string; day: string }

const base = () => `${browserApiBase()}/api/notify`;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${base()}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!r.ok) {
    let msg = 'That didn’t save. Try again.';
    try {
      const j = await r.json();
      msg = typeof j.detail === 'string' ? j.detail : j.detail?.message ?? msg;
    } catch { /* keep the plain message */ }
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}

let flagsCache: Promise<NotifyFlags> | null = null;

export function notifyFlags(): Promise<NotifyFlags> {
  // R10-3: the page-wide signal cuts this off when the page starts to unload.
  flagsCache ??= pageScoped((signal) => call<NotifyFlags>('/flags', signal ? { signal } : undefined)).catch((e: unknown) => {
    if ((e as { name?: string })?.name === 'AbortError') flagsCache = null; // cut off: ask again next time
    return { payday_email: false, deadline_reminders: false, reply_done: false };
  });
  return flagsCache;
}

export const notifyApi = {
  settings: () => call<{ payday: { on: boolean; day: number | null; list_month: string | null }; reminders: { on: boolean; count: number }; email: string }>('/settings'),
  payday: (body: { on: boolean; day?: number | null; snapshot?: unknown }) =>
    call<{ ok: boolean }>('/payday', { method: 'PUT', body: JSON.stringify(body) }),
  reminders: (body: { on: boolean; source: 'complaint' | 'closure'; items: { key: string; label: string; day: string; state?: string }[] }) =>
    call<{ ok: boolean; next: { send_on: string; text: string } | null }>('/reminders', { method: 'PUT', body: JSON.stringify(body) }),
  answers: () => call<{ answers: NotifyAnswer[] }>('/answers'),
  applied: (id: number) => call<{ ok: boolean }>(`/answers/${id}/applied`, { method: 'POST' }),
};
