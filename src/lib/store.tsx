'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type {
  Country,
  FinancialGoal,
  Loan,
  ParsedSms,
  PaymentLogEntry,
  PaymentStatus,
  PayoffStrategy,
  StressScenario,
  ThemeMode,
  TrackedCase,
  UserProfile,
} from '@/engine/types';
import { DEFAULT_PROFILES, DEFAULT_STRESS_SCENARIO } from '@/engine/presets';
import { parseBulkInput } from '@/engine/smsParser';

export type AppSection = 'command' | 'shield' | 'sms' | 'decisions' | 'cant-pay' | 'vault';

interface PersistedState {
  country: Country;
  profiles: Record<Country, UserProfile>;
  strategy: PayoffStrategy;
  paidIds: string[];
  paymentLogs: Record<string, PaymentLogEntry>;
  stressByCountry: Record<Country, StressScenario>;
  trackedCases: TrackedCase[];
  importedSms: ParsedSms[];
  theme: ThemeMode;
}

const STORAGE_KEY = 'rightdue_v4_state';

function initialState(): PersistedState {
  return {
    country: 'IN',
    profiles: DEFAULT_PROFILES,
    strategy: 'avalanche',
    paidIds: [],
    paymentLogs: {},
    stressByCountry: {
      IN: { ...DEFAULT_STRESS_SCENARIO },
      US: { ...DEFAULT_STRESS_SCENARIO },
    },
    trackedCases: [],
    importedSms: [],
    theme: 'light',
  };
}

interface RightDueContextValue {
  section: AppSection;
  setSection: (s: AppSection) => void;
  onboardingOpen: boolean;
  setOnboardingOpen: (open: boolean) => void;
  country: Country;
  setCountry: (c: Country) => void;
  profile: UserProfile;
  updateProfile: (patch: Partial<UserProfile>) => void;
  addLoan: (loan: Loan) => void;
  updateLoan: (id: string, patch: Partial<Loan>) => void;
  deleteLoan: (id: string) => void;
  addGoal: (goal: FinancialGoal) => void;
  updateGoal: (id: string, patch: Partial<FinancialGoal>) => void;
  deleteGoal: (id: string) => void;
  toggleGoal: (id: string) => void;
  strategy: PayoffStrategy;
  setStrategy: (s: PayoffStrategy) => void;
  stress: StressScenario;
  updateStress: (patch: Partial<StressScenario>) => void;
  resetStress: () => void;
  paidIds: string[];
  togglePaid: (id: string) => void;
  paymentLogs: Record<string, PaymentLogEntry>;
  logPayment: (loanId: string, status: PaymentStatus, amountPaid: number) => void;
  clearPaymentLog: (loanId: string) => void;
  trackedCases: TrackedCase[];
  addTrackedCase: (c: TrackedCase) => void;
  updateCaseStatus: (id: string, status: TrackedCase['status']) => void;
  importedSms: ParsedSms[];
  setImportedSms: (rows: ParsedSms[]) => void;
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
  resetAllData: () => void;
  exportJson: () => string;
}

const RightDueContext = createContext<RightDueContextValue | null>(null);

export function RightDueProvider({ children }: { children: React.ReactNode }) {
  const [section, setSection] = useState<AppSection>('command');
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [state, setState] = useState<PersistedState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw =
        window.localStorage.getItem(STORAGE_KEY) ||
        window.localStorage.getItem('rightdue_v3_state') ||
        window.localStorage.getItem('rightdue_v2_state');
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PersistedState> & { stress?: Partial<StressScenario> };
        setState((prev) => ({
          ...prev,
          ...parsed,
          stressByCountry: {
            IN: {
              ...DEFAULT_STRESS_SCENARIO,
              ...(parsed.stressByCountry?.IN ?? (parsed.country === 'IN' ? parsed.stress : {})),
            },
            US: {
              ...DEFAULT_STRESS_SCENARIO,
              ...(parsed.stressByCountry?.US ?? (parsed.country === 'US' ? parsed.stress : {})),
            },
          },
          paymentLogs: parsed.paymentLogs ?? {},
          theme:
            parsed.theme === 'dark' || parsed.theme === 'ledger' || parsed.theme === 'light'
              ? parsed.theme
              : 'light',
          profiles: {
            IN: {
              ...DEFAULT_PROFILES.IN,
              ...(parsed.profiles?.IN ?? {}),
              goals: parsed.profiles?.IN?.goals ?? DEFAULT_PROFILES.IN.goals,
            },
            US: {
              ...DEFAULT_PROFILES.US,
              ...(parsed.profiles?.US ?? {}),
              goals: parsed.profiles?.US?.goals ?? DEFAULT_PROFILES.US.goals,
            },
          },
        }));
      }
    } catch {
      // Ignore corrupt storage
    }

    // Zero-cloud iOS Shortcut / Android Share bridge via #sms=<uri-encoded-text>
    try {
      const hash = window.location.hash;
      if (hash.startsWith('#sms=')) {
        const decoded = decodeURIComponent(hash.slice(5));
        if (decoded.trim().length > 6) {
          setState((prev) => {
            const curProfile = prev.profiles[prev.country];
            const { rows } = parseBulkInput(decoded, curProfile.loans, { defaultCountry: prev.country });
            return { ...prev, importedSms: [...rows, ...prev.importedSms] };
          });
          setSection('sms');
          window.history.replaceState(null, '', window.location.pathname);
        }
      }
    } catch {
      // Ignore malformed hash
    }

    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage quota fallback
    }
  }, [state, hydrated]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'ledger');
    if (state.theme === 'dark') {
      root.classList.add('dark');
    } else if (state.theme === 'ledger') {
      root.classList.add('ledger');
    }
  }, [state.theme]);

  const value = useMemo<RightDueContextValue>(() => {
    const profile = state.profiles[state.country];

    return {
      section,
      setSection,
      onboardingOpen,
      setOnboardingOpen,
      country: state.country,
      setCountry: (country) => setState((prev) => ({ ...prev, country })),
      profile,
      updateProfile: (patch) =>
        setState((prev) => ({
          ...prev,
          profiles: {
            ...prev.profiles,
            [prev.country]: { ...prev.profiles[prev.country], ...patch },
          },
        })),
      addLoan: (loan) =>
        setState((prev) => {
          const cur = prev.profiles[prev.country];
          return {
            ...prev,
            profiles: {
              ...prev.profiles,
              [prev.country]: { ...cur, loans: [...cur.loans, loan] },
            },
          };
        }),
      updateLoan: (id, patch) =>
        setState((prev) => {
          const cur = prev.profiles[prev.country];
          return {
            ...prev,
            profiles: {
              ...prev.profiles,
              [prev.country]: {
                ...cur,
                loans: cur.loans.map((l) => (l.id === id ? { ...l, ...patch } : l)),
              },
            },
          };
        }),
      deleteLoan: (id) =>
        setState((prev) => {
          const cur = prev.profiles[prev.country];
          return {
            ...prev,
            profiles: {
              ...prev.profiles,
              [prev.country]: {
                ...cur,
                loans: cur.loans.filter((l) => l.id !== id),
              },
            },
          };
        }),
      addGoal: (goal) =>
        setState((prev) => {
          const cur = prev.profiles[prev.country];
          return {
            ...prev,
            profiles: {
              ...prev.profiles,
              [prev.country]: { ...cur, goals: [...(cur.goals ?? []), goal] },
            },
          };
        }),
      updateGoal: (id, patch) =>
        setState((prev) => {
          const cur = prev.profiles[prev.country];
          return {
            ...prev,
            profiles: {
              ...prev.profiles,
              [prev.country]: {
                ...cur,
                goals: (cur.goals ?? []).map((g) => (g.id === id ? { ...g, ...patch } : g)),
              },
            },
          };
        }),
      deleteGoal: (id) =>
        setState((prev) => {
          const cur = prev.profiles[prev.country];
          return {
            ...prev,
            profiles: {
              ...prev.profiles,
              [prev.country]: {
                ...cur,
                goals: (cur.goals ?? []).filter((g) => g.id !== id),
              },
            },
          };
        }),
      toggleGoal: (id) =>
        setState((prev) => {
          const cur = prev.profiles[prev.country];
          return {
            ...prev,
            profiles: {
              ...prev.profiles,
              [prev.country]: {
                ...cur,
                goals: (cur.goals ?? []).map((g) => (g.id === id ? { ...g, enabled: !g.enabled } : g)),
              },
            },
          };
        }),
      strategy: state.strategy,
      setStrategy: (strategy) => setState((prev) => ({ ...prev, strategy })),
      stress: state.stressByCountry[state.country] ?? DEFAULT_STRESS_SCENARIO,
      updateStress: (patch) =>
        setState((prev) => ({
          ...prev,
          stressByCountry: {
            ...prev.stressByCountry,
            [prev.country]: {
              ...(prev.stressByCountry[prev.country] ?? DEFAULT_STRESS_SCENARIO),
              ...patch,
            },
          },
        })),
      resetStress: () =>
        setState((prev) => ({
          ...prev,
          stressByCountry: {
            ...prev.stressByCountry,
            [prev.country]: { ...DEFAULT_STRESS_SCENARIO },
          },
        })),
      paidIds: state.paidIds,
      togglePaid: (id) =>
        setState((prev) => ({
          ...prev,
          paidIds: prev.paidIds.includes(id)
            ? prev.paidIds.filter((x) => x !== id)
            : [...prev.paidIds, id],
        })),
      paymentLogs: state.paymentLogs,
      logPayment: (loanId, status, amountPaid) =>
        setState((prev) => ({
          ...prev,
          paidIds:
            status === 'unable'
              ? prev.paidIds.filter((x) => x !== loanId)
              : prev.paidIds.includes(loanId)
                ? prev.paidIds
                : [...prev.paidIds, loanId],
          paymentLogs: {
            ...prev.paymentLogs,
            [loanId]: {
              loanId,
              status,
              amountPaid: Math.max(0, Math.round(amountPaid)),
              loggedAt: new Date().toISOString().slice(0, 10),
            },
          },
        })),
      clearPaymentLog: (loanId) =>
        setState((prev) => {
          const nextLogs = { ...prev.paymentLogs };
          delete nextLogs[loanId];
          return {
            ...prev,
            paidIds: prev.paidIds.filter((x) => x !== loanId),
            paymentLogs: nextLogs,
          };
        }),
      trackedCases: state.trackedCases,
      addTrackedCase: (c) =>
        setState((prev) => ({ ...prev, trackedCases: [c, ...prev.trackedCases] })),
      updateCaseStatus: (id, status) =>
        setState((prev) => ({
          ...prev,
          trackedCases: prev.trackedCases.map((c) => (c.id === id ? { ...c, status } : c)),
        })),
      importedSms: state.importedSms,
      setImportedSms: (importedSms) => setState((prev) => ({ ...prev, importedSms })),
      theme: state.theme,
      setTheme: (theme) => setState((prev) => ({ ...prev, theme })),
      toggleTheme: () =>
        setState((prev) => ({
          ...prev,
          theme: prev.theme === 'light' ? 'ledger' : prev.theme === 'ledger' ? 'dark' : 'light',
        })),
      resetAllData: () => {
        try {
          window.localStorage.removeItem(STORAGE_KEY);
          window.localStorage.removeItem('rightdue_v2_state');
        } catch {
          // ignore
        }
        setState(initialState());
      },
      exportJson: () => JSON.stringify(state, null, 2),
    };
  }, [section, onboardingOpen, state]);

  return <RightDueContext.Provider value={value}>{children}</RightDueContext.Provider>;
}

export function useRightDue() {
  const ctx = useContext(RightDueContext);
  if (!ctx) throw new Error('useRightDue must be used inside RightDueProvider');
  return ctx;
}
