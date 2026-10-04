/** Safe readiness checks, separate from the one-time email mutation. */
export class SignInApiStarting extends Error {}

export async function waitForSignInApi(base: string): Promise<void> {
  const deadline = Date.now() + 55000;
  for (let attempt = 0; attempt < 5; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const response = await fetch(
        `${base.replace(/\/$/, '')}/api/health`,
        { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(Math.min(15000, remaining)) },
      );
      if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
        if ((await response.json())?.status === 'ok') return;
      }
      // Render can return plain 429 or a startup page before the app is ready.
      // Only these safe GETs are retried; application OTP limits still apply.
      if (!response.ok && response.status !== 429 && response.status < 500) break;
    } catch { /* A timed-out readiness read can safely be tried again. */ }
    if (attempt < 4 && Date.now() + 1000 < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new SignInApiStarting();
}
