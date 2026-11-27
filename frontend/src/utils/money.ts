import type { Money } from '@/api/types';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const inrCompact = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/**
 * Convert a money value (BigDecimal serialised as number or string) to integer paise.
 * Parses the decimal string directly so values like "1500.01" never pass through float math.
 */
export function toPaise(value: Money | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const s = typeof value === 'number' ? value.toFixed(2) : value.trim();
  const m = /^(-)?(\d*)(?:\.(\d{0,}))?$/.exec(s);
  if (!m) return 0;
  const neg = m[1] === '-';
  const rupees = Number(m[2] || '0');
  const fracStr = (m[3] ?? '').padEnd(3, '0');
  // round half-up on the 3rd decimal
  let paise = Number(fracStr.slice(0, 2));
  if (Number(fracStr[2]) >= 5) paise += 1;
  const total = rupees * 100 + paise;
  return neg ? -total : total;
}

export function fromPaise(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

export function sumMoney(values: (Money | null | undefined)[]): string {
  return fromPaise(values.reduce<number>((acc, v) => acc + toPaise(v), 0));
}

/** `₹1,20,000.00` — Indian grouping, 2 decimals. */
export function formatINR(value: Money | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return inr.format(toPaise(value) / 100);
}

/** `₹1.2L` style for chart axes. */
export function formatINRCompact(value: number): string {
  return inrCompact.format(value);
}

/** Plain number for charts (display only — never fed back into arithmetic). */
export function toNumber(value: Money | null | undefined): number {
  return toPaise(value) / 100;
}

/** Validates a user-entered amount string: positive, at most 2 decimals. */
export function isValidAmount(s: string): boolean {
  return /^\d{1,12}(\.\d{1,2})?$/.test(s.trim()) && toPaise(s) > 0;
}
