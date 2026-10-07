/**
 * Where to go after sign-in. Only same-origin paths are allowed (M4):
 * "/\t/evil.com" passed the old startsWith('/') checks, and browsers strip
 * tab/CR/LF while parsing, so it resolved to //evil.com.
 */
export function safeRedirect(next: string | null | undefined, origin: string): string {
  if (!next || !next.startsWith('/')) return '/';
  // Control characters and backslashes never belong in an internal path.
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return '/';
  try {
    const base = new URL(origin);
    const url = new URL(next, base);
    if (url.origin !== base.origin) return '/';
    if (url.pathname.startsWith('//')) return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}
