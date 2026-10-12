/**
 * How the profile is stored in cookies, shared by the browser (document.cookie)
 * and the server (next/headers).
 *
 * It used to be one cookie of URL-encoded JSON. Browsers drop a cookie over
 * about 4 KB, so nine ordinary loans (or fewer with assets and details)
 * silently failed to save: setup stayed put and a reload started again.
 * The JSON is now compressed (lz-string, URL-safe, typically 4–6× smaller)
 * and split across numbered cookies when it's still large:
 *
 *   rightdue_user   = "z1.<count>.<first part>"
 *   rightdue_user_1 = "<second part>"  …
 *
 * A cookie holding plain JSON (the old format) is still read.
 */
import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from 'lz-string';

export const PROFILE_COOKIE = 'rightdue_user';
const PREFIX = 'z1.';
/** Characters per cookie, under the ~4096 bytes a browser keeps for name,
 *  value and attributes together. */
const CHUNK = 3800;
/** Most parts written or read: about 60 KB compressed, far past any real
 *  profile, and inside the server's 16 KB request-header limit only while
 *  the profile stays well below it (a few hundred loans). */
export const MAX_PROFILE_CHUNKS = 16;

export function profileChunkName(i: number): string {
  return i === 0 ? PROFILE_COOKIE : `${PROFILE_COOKIE}_${i}`;
}

/** The cookie values for a profile's JSON, first part first. */
export function encodeProfileCookies(json: string): string[] {
  const packed = compressToEncodedURIComponent(json);
  const parts: string[] = [];
  for (let i = 0; i < packed.length; i += CHUNK) parts.push(packed.slice(i, i + CHUNK));
  if (parts.length === 0) parts.push('');
  parts[0] = `${PREFIX}${parts.length}.${parts[0]}`;
  return parts;
}

/** The profile's JSON from whichever cookies hold it, or null when there
 *  is none or a part is missing. `get` returns a cookie's decoded value. */
export function decodeProfileCookies(
  get: (name: string) => string | null | undefined,
): string | null {
  const first = get(PROFILE_COOKIE);
  if (!first) return null;
  if (!first.startsWith(PREFIX)) return first;
  const m = /^z1\.(\d+)\./.exec(first);
  if (!m) return null;
  const count = Number(m[1]);
  if (!(count >= 1 && count <= MAX_PROFILE_CHUNKS)) return null;
  let packed = first.slice(m[0].length);
  for (let i = 1; i < count; i++) {
    const part = get(profileChunkName(i));
    if (part == null) return null;
    packed += part;
  }
  return decompressFromEncodedURIComponent(packed) || null;
}
