/**
 * Where the user lives (live test #5, sprint L3): a state picker per country
 * and a free-text city, both optional, on Profile → Country.
 *
 * India: the 28 states and 8 union territories (Delhi is the NCT of Delhi).
 * USA: the 50 states and the District of Columbia. Stored by full name, the
 * form the engine's `User.state` / `Asset.state` already takes.
 *
 * What it changes today: the engine reads `user.state` as the default
 * state of a held property in the sell-to-repay scan
 * (engine/asset_liquidation.py, a label there today), and Profile shows
 * "Chennai, Tamil Nadu". No number changes by state yet:
 * per-state figures (stamp duty on a purchase, US state income tax) need a
 * dated source per state before they are used (see answers/L3.md).
 */
import type { Country } from './api';

export const IN_STATES: readonly string[] = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal',
  // Union territories
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

export const US_STATES: readonly string[] = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois',
  'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
  'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana',
  'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York',
  'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah',
  'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
];

export function statesFor(country: Country): readonly string[] {
  return country === 'IN' ? IN_STATES : US_STATES;
}

/** The saved state if it belongs to `country`, else '' (a country switch
 *  drops a state from the other list). */
export function stateFor(country: Country, state: string | undefined | null): string {
  const s = (state ?? '').trim();
  return statesFor(country).includes(s) ? s : '';
}

/** A city as typed, tidied: single spaces, at most 60 characters. */
export function cleanCity(city: string | undefined | null): string {
  return (city ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** "Chennai, Tamil Nadu", "Tamil Nadu", "Chennai" or ''. */
export function placeLabel(user: { city?: string; state?: string; country: Country }): string {
  return [cleanCity(user.city), stateFor(user.country, user.state)].filter(Boolean).join(', ');
}

export const STATE_HELP: Record<Country, string> = {
  IN: 'Optional. Saved with your profile, and sent to the engine as the state of a property you hold when it has none. Nothing in your plan changes by state yet: state rules (like stamp duty when you buy a home) will use it as they are added, each with its source.',
  US: 'Optional. Saved with your profile, and sent to the engine as the state of a property you hold when it has none. Your state income tax rate is still entered with your tax details; it is not filled in from the state yet.',
};
