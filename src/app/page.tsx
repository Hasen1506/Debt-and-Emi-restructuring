'use client';

import React from 'react';
import { AppShell } from '@/components/AppShell';
import { CommandCenter } from '@/components/CommandCenter';
import { LoanShield } from '@/components/LoanShield';
import { SmsPulse } from '@/components/SmsPulse';
import { DecisionLab } from '@/components/DecisionLab';
import { CantPayShield, LoansAndVault } from '@/components/DistressAndVault';
import { OnboardingDrawer } from '@/components/OnboardingDrawer';
import { useRightDue } from '@/lib/store';

export default function HomePage() {
  const { section } = useRightDue();

  return (
    <AppShell>
      {section === 'command' && <CommandCenter />}
      {section === 'shield' && <LoanShield />}
      {section === 'sms' && <SmsPulse />}
      {section === 'decisions' && <DecisionLab />}
      {section === 'cant-pay' && <CantPayShield />}
      {section === 'vault' && <LoansAndVault />}
      <OnboardingDrawer />
    </AppShell>
  );
}
