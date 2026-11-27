export const IST = 'Asia/Kolkata';

const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  timeZone: IST,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const isoPartsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function parse(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  // A bare LocalDate ("2026-11-27") is interpreted as an IST calendar date.
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00+05:30`) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `27 Nov 2026, 14:05 IST` */
export function formatIST(value: string | Date | null | undefined): string {
  const d = parse(value);
  return d ? `${dateTimeFmt.format(d)} IST` : '—';
}

/** `27 Nov 2026` */
export function formatISTDate(value: string | Date | null | undefined): string {
  const d = parse(value);
  return d ? dateFmt.format(d) : '—';
}

/** Today's calendar date in IST as `yyyy-MM-dd` (for `<input type="date" max>`). */
export function todayIST(): string {
  return isoPartsFmt.format(new Date());
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoPartsFmt.format(d);
}

/** Day of week (0 = Sunday) of an IST calendar date. */
export function dayOfWeekIST(iso: string): number {
  const d = new Date(`${iso}T12:00:00+05:30`);
  return d.getUTCDay();
}

export function secondsSince(value: string | null | undefined, now = Date.now()): number | null {
  const d = parse(value);
  if (!d) return null;
  return Math.max(0, Math.floor((now - d.getTime()) / 1000));
}

/** `2d 4h`, `5h 12m`, `8m` */
export function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(m, 0)}m`;
}

export type AgeTone = 'normal' | 'warn' | 'danger';

export function ageTone(seconds: number | null | undefined): AgeTone {
  if (seconds === null || seconds === undefined) return 'normal';
  if (seconds > 48 * 3600) return 'danger';
  if (seconds > 24 * 3600) return 'warn';
  return 'normal';
}

/** Age for an item that has either `ageSeconds` or an `activatedAt` timestamp. */
export function itemAge(item: { ageSeconds?: number | null; activatedAt?: string | null }): number | null {
  if (typeof item.ageSeconds === 'number') return item.ageSeconds;
  return secondsSince(item.activatedAt);
}

export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return '—';
  return formatAge(Math.round(hours * 3600));
}

/** `yyyy-MM` → `Nov 2026` */
export function formatMonth(ym: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  if (!m) return ym;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15));
  return d.toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Converts a `datetime-local` value (entered in IST) to an ISO instant with +05:30 offset. */
export function localInputToISTInstant(v: string): string {
  return v.length === 16 ? `${v}:00+05:30` : `${v}+05:30`;
}

/** Current IST time formatted for `<input type="datetime-local">`. */
export function nowISTLocalInput(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}
