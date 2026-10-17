/**
 * How the sign-in page introduces itself (Audit 80 B1).
 *
 * The founder's rule stays: sign-in comes before the plan. But a first-time
 * visitor who tapped "Start your plan" must not land on a page that only says
 * "Sign in", which reads as "for people who already have an account". When
 * the page was reached on the way to Setup (next=/onboarding, or the landing
 * CTA's ?start=1), it is framed as step 1 of starting a free plan.
 */
export type LoginFrame = 'start' | 'signin';

export const START_STEPS = ['Email', 'Your money', 'Your loans', 'Your plan'] as const;

export function loginFrame(next: string | null | undefined, start?: string | null): LoginFrame {
  if (start === '1') return 'start';
  if (!next) return 'signin';
  const path = next.split('?')[0].split('#')[0];
  return path === '/onboarding' || path.startsWith('/onboarding/') ? 'start' : 'signin';
}

export const LOGIN_COPY: Record<LoginFrame, { title: string; sub: string; code: string }> = {
  start: {
    title: 'Start your free plan',
    sub: 'Step 1 of 4: confirm your email. This creates your free account; the 6-digit code arrives from RightDue in under a minute. No passwords, no bank login.',
    code: 'Enter the 6-digit code we emailed you. Next: what comes in and goes out each month.',
  },
  signin: {
    title: 'Sign in',
    sub: 'We\u2019ll email you a 6-digit code. No passwords. New here? The same code creates your free account.',
    code: 'Enter the 6-digit code we emailed you.',
  },
};

/** What step 3 of Setup will show, previewed before the email box (B1). */
export const START_PREVIEW = [
  'The date you\u2019ll be debt-free, with this month\u2019s payment for each loan or card',
  'Which loan gets any extra money first, and what that saves vs the way most people pay',
  'Nothing is linked to your bank; you type what you owe, and can delete it any time',
] as const;
