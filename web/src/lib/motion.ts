/** 'smooth' unless the user asked the OS for reduced motion (UX50 C-24). */
export function smoothOrAuto(): ScrollBehavior {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'smooth';
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}
