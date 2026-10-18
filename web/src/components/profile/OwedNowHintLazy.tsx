'use client';
/** Profile's owed-now line, loaded after the form (it reads this browser's Activity). */
import dynamic from 'next/dynamic';

export const OwedNowHintLazy = dynamic(() => import('./OwedNowHint').then((m) => m.OwedNowHint), { ssr: false });
