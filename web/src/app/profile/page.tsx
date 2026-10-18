import { Suspense } from 'react';
import { loadProfileServer } from '@/lib/user-store';
import { StrategyCompare, StrategyCompareLoading } from '@/components/personas/StrategyCompare';
import { ProfileClient } from './ProfileClient';

/** Its own tab title (UX50 C-26 / E-15). */
export const metadata = { title: 'Profile · RightDue' };

export const dynamic = 'force-dynamic';

/**
 * Profile: the form and summary run in the browser (ProfileClient); the
 * payoff orders at the bottom are worked out here and stream in after.
 */
export default async function ProfilePage() {
  const profile = await loadProfileServer();
  const hasDebt = profile.isLive && profile.user.loans.some((l) => Number(l.outstanding) > 0);
  return (
    <ProfileClient
      initial={profile}
      payoffOrder={
        hasDebt ? (
          <Suspense fallback={<StrategyCompareLoading />}>
            <StrategyCompare />
          </Suspense>
        ) : null
      }
    />
  );
}
