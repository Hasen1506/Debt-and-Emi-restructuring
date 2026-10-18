'use client';
/** The debt-budget prompt, loaded only when it shows (most users have chosen),
 *  so Home and Plan don't carry it in their first bundle. */
import dynamic from 'next/dynamic';

export const DebtBudgetPromptLazy = dynamic(() => import('./DebtBudgetControl').then((m) => m.DebtBudgetPrompt));
