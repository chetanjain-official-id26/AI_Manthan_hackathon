import { describe, expect, it } from 'vitest';
import { formatINR, fromPaise, isValidAmount, sumMoney, toPaise } from './money';
import { addDaysISO, ageTone, dayOfWeekIST, formatAge, formatIST, formatMonth, localInputToISTInstant, secondsSince } from './time';
import { cityTierFor, tierLabel } from './cities';
import { explainResult, initials, ruleLabel } from './labels';
import { validateReceiptFile } from './misc';

describe('money (integer paise, Indian grouping)', () => {
  it('TC-FE-U01 formats INR with Indian grouping and 2 decimals', () => {
    expect(formatINR('120000')).toBe('₹1,20,000.00');
    expect(formatINR(1500)).toBe('₹1,500.00');
    expect(formatINR('0.5')).toBe('₹0.50');
    expect(formatINR(null)).toBe('—');
  });

  it('TC-FE-U02 parses decimals without float drift', () => {
    expect(toPaise('1500.01')).toBe(150001);
    expect(toPaise('0.1')).toBe(10);
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise('-25.50')).toBe(-2550);
    expect(toPaise('abc')).toBe(0);
    expect(fromPaise(150001)).toBe('1500.01');
  });

  it('TC-FE-U03 sums amounts exactly (bulk bar and batch preview)', () => {
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
    expect(sumMoney(['18250.00', 25000, '5000'])).toBe('48250.00');
    expect(sumMoney([])).toBe('0.00');
  });

  it('TC-FE-U04 validates line amounts (> 0, max 2 decimals)', () => {
    expect(isValidAmount('500')).toBe(true);
    expect(isValidAmount('500.01')).toBe(true);
    expect(isValidAmount('0')).toBe(false);
    expect(isValidAmount('-5')).toBe(false);
    expect(isValidAmount('1.234')).toBe(false);
    expect(isValidAmount('')).toBe(false);
  });
});

describe('time (IST, SLA age)', () => {
  it('TC-FE-U05 formats SLA age as d/h/m', () => {
    expect(formatAge(2 * 86400 + 4 * 3600)).toBe('2d 4h');
    expect(formatAge(5 * 3600 + 12 * 60)).toBe('5h 12m');
    expect(formatAge(480)).toBe('8m');
    expect(formatAge(null)).toBe('—');
  });

  it('TC-FE-U06 age tone: amber > 24 h, red > 48 h', () => {
    expect(ageTone(24 * 3600)).toBe('normal');
    expect(ageTone(24 * 3600 + 1)).toBe('warn');
    expect(ageTone(48 * 3600)).toBe('warn');
    expect(ageTone(48 * 3600 + 1)).toBe('danger');
  });

  it('TC-FE-U07 renders timestamps in IST', () => {
    // 18:00 UTC = 23:30 IST
    expect(formatIST('2026-11-28T18:00:00Z')).toMatch(/28 Nov 2026.*23:30 IST/);
  });

  it('TC-FE-U08 weekday of an IST calendar date (Sat/Sun)', () => {
    expect(dayOfWeekIST('2026-11-28')).toBe(6); // Saturday
    expect(dayOfWeekIST('2026-11-29')).toBe(0); // Sunday
    expect(dayOfWeekIST('2026-11-27')).toBe(5); // Friday
  });

  it('TC-FE-U09 date helpers', () => {
    expect(addDaysISO('2026-11-27', 1)).toBe('2026-11-28');
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(formatMonth('2026-11')).toMatch(/Nov.*2026/);
    expect(localInputToISTInstant('2026-11-27T10:30')).toBe('2026-11-27T10:30:00+05:30');
    expect(secondsSince(new Date(Date.now() - 90_000).toISOString())).toBeGreaterThanOrEqual(89);
  });
});

describe('cities and labels', () => {
  it('TC-FE-U10 city sets tier (incl. aliases, case and spaces)', () => {
    expect(cityTierFor('Mumbai')).toBe('TIER_1');
    expect(cityTierFor('  bangalore ')).toBe('TIER_1');
    expect(cityTierFor('New Delhi')).toBe('TIER_1');
    expect(cityTierFor('Jaipur')).toBe('OTHER');
    expect(cityTierFor('')).toBe('OTHER');
    expect(tierLabel('TIER_1')).toBe('Tier-1');
  });

  it('TC-FE-U11 explains a policy flag with rule, actual and limit', () => {
    expect(explainResult({ claimLineId: 1, ruleCode: 'MEAL_DAILY_LIMIT', outcome: 'ROUTE', limitAmount: '1500', actualAmount: '1800' })).toBe(
      'Meal daily limit: ₹1,800.00 > ₹1,500.00 per day',
    );
    expect(explainResult({ claimLineId: 1, ruleCode: 'RECEIPT_REQUIRED', outcome: 'AUTO_REJECT', limitAmount: '500', reason: 'RECEIPT_REQUIRED' })).toBe(
      'Receipt required above ₹500.00',
    );
    expect(explainResult({ claimLineId: 1, ruleCode: 'DUPLICATE_RECEIPT_HASH', outcome: 'ROUTE', matchClaimNo: 'CLM-2026-0088' })).toBe(
      'Duplicate receipt file: matches CLM-2026-0088',
    );
    expect(explainResult({ claimLineId: 1, ruleCode: 'X', outcome: 'ROUTE', reason: 'Custom server reason' })).toBe('Custom server reason');
    expect(ruleLabel('SOME_NEW_RULE')).toBe('Some new rule');
    expect(initials('Ananya Rao')).toBe('AR');
  });

  it('TC-FE-U12 receipt file validation: type and 5 MB limit', () => {
    const f = (name: string, type: string, size: number) => new File([new Uint8Array(size)], name, { type });
    expect(validateReceiptFile(f('r.jpg', 'image/jpeg', 2 * 1024 * 1024))).toBeNull();
    expect(validateReceiptFile(f('r.pdf', 'application/pdf', 1000))).toBeNull();
    expect(validateReceiptFile(f('r.exe', 'application/x-msdownload', 1000))).toMatch(/Only PDF, JPG or PNG/);
    expect(validateReceiptFile(f('r.html', 'text/html', 1000))).toMatch(/Only PDF/);
    expect(validateReceiptFile(f('big.png', 'image/png', 6 * 1024 * 1024))).toMatch(/limit is 5 MB/);
    expect(validateReceiptFile(f('empty.png', 'image/png', 0))).toMatch(/empty/);
  });
});
