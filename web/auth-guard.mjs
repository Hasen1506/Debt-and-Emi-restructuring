// Grill #66: NEXT_PUBLIC_DISABLE_AUTH is compiled into the bundle, so one
// mis-set build variable would ship a public app with sign-in switched off.
// A production build (and the container start, deploy/start.sh) now refuses
// that combination unless RIGHTDUE_ALLOW_DISABLED_AUTH=1 says it is meant,
// e.g. a local walkthrough build. next.config.mjs calls this on load.

/** @param {Record<string, string | undefined>} env */
export function disabledAuthProblem(env = process.env) {
  if (env.NEXT_PUBLIC_DISABLE_AUTH !== 'true') return null;
  if (env.NODE_ENV !== 'production') return null;
  if (env.RIGHTDUE_ALLOW_DISABLED_AUTH === '1') return null;
  return (
    'Refusing a production build with NEXT_PUBLIC_DISABLE_AUTH=true: it would ship the app ' +
    'with sign-in switched off. Set NEXT_PUBLIC_DISABLE_AUTH=false, or, for a local ' +
    'walkthrough only, also set RIGHTDUE_ALLOW_DISABLED_AUTH=1 (never on a public deploy).'
  );
}

/** @param {Record<string, string | undefined>} env */
export function assertAuthEnabledForProduction(env = process.env) {
  const problem = disabledAuthProblem(env);
  if (problem) throw new Error(problem);
}
