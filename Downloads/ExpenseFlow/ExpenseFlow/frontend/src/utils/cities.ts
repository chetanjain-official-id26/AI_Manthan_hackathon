import type { CityTier } from '@/api/types';

export const TIER_1_CITIES = [
  'Mumbai',
  'Delhi',
  'Bengaluru',
  'Hyderabad',
  'Chennai',
  'Kolkata',
  'Pune',
  'Ahmedabad',
] as const;

export const OTHER_CITIES = [
  'Jaipur',
  'Lucknow',
  'Indore',
  'Bhopal',
  'Chandigarh',
  'Kochi',
  'Coimbatore',
  'Nagpur',
  'Surat',
  'Vadodara',
  'Visakhapatnam',
  'Patna',
  'Bhubaneswar',
  'Guwahati',
  'Mysuru',
  'Nashik',
  'Raipur',
  'Dehradun',
  'Thiruvananthapuram',
  'Goa',
] as const;

export const ALL_CITIES: readonly string[] = [...TIER_1_CITIES, ...OTHER_CITIES].sort((a, b) => a.localeCompare(b));

const ALIASES: Record<string, string> = {
  bangalore: 'bengaluru',
  bombay: 'mumbai',
  'new delhi': 'delhi',
  calcutta: 'kolkata',
  madras: 'chennai',
};

const tier1 = new Set(TIER_1_CITIES.map((c) => c.toLowerCase()));

export function cityTierFor(city: string): CityTier {
  const k = city.trim().toLowerCase();
  const canonical = ALIASES[k] ?? k;
  return tier1.has(canonical) ? 'TIER_1' : 'OTHER';
}

export function tierLabel(t: CityTier | null | undefined): string {
  return t === 'TIER_1' ? 'Tier-1' : t === 'OTHER' ? 'Other city' : '—';
}
