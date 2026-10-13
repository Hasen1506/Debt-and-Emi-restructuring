import type { ReactNode } from 'react';

/** Its own tab title (UX50 C-26 / E-15); the page itself is a client component. */
export const metadata = { title: 'Your data · RightDue' };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
