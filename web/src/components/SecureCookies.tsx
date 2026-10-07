'use client';

import { installSecureCookieDefault } from '@/lib/secure-cookies';

// Runs when the client bundle loads, before any component writes a cookie.
installSecureCookieDefault();

/** Mount once in the root layout; renders nothing (BUG_REPORT M9). */
export function SecureCookies(): null {
  return null;
}
