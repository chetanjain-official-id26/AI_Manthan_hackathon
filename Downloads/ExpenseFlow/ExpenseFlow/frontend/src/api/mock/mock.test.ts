import { describe, expect, it } from 'vitest';
import { seed } from './seed';
import { mockFetch, resetMockDb } from './server';

async function call(method: string, path: string, opts: { token?: number; body?: unknown } = {}) {
  const headers = new Headers();
  if (opts.token) headers.set('Authorization', `Bearer mock-${opts.token}`);
  const res = await mockFetch(method, `http://localhost/api${path}`, { headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as unknown };
}

const line = (over: object = {}) => ({
  category: 'OTHER',
  amount: '30000.00',
  expenseDate: '2026-11-25',
  vendor: 'Vendor',
  city: 'Pune',
  cityTier: 'TIER_1',
  nights: null,
  description: '',
  ...over,
});

describe('demo mock backend (offline preview)', () => {
  it('TC-FE-MK01 seeds a consistent organisation and history', () => {
    const db = seed(Date.parse('2026-11-27T06:00:00Z'));
    expect(db.users.filter((u) => u.roles.includes('FINANCE_HEAD'))).toHaveLength(1);
    expect(db.claims.length).toBeGreaterThan(100);
    const statuses = new Set(db.claims.map((c) => c.status));
    for (const s of ['DRAFT', 'PENDING_MANAGER', 'PENDING_AUDITOR', 'APPROVED', 'PAID', 'SENT_BACK']) expect(statuses).toContain(s);
    expect(db.results.some((r) => r.ruleCode === 'DUPLICATE_RECEIPT_HASH')).toBe(true);
    for (const s of db.steps) if (s.actedById) expect(db.claim(s.claimId)?.employeeId).not.toBe(s.actedById);
    expect(db.audit.length).toBeGreaterThan(db.claims.length);
    // R1 planted split reaches the auditor; nothing older than 30 days is left pending
    expect(db.claims.some((c) => c.flags.includes('SPLIT_SUSPECT') && c.status === 'PENDING_AUDITOR')).toBe(true);
    const now = Date.parse('2026-11-27T06:00:00Z');
    const stale = db.steps.filter((s) => s.status === 'PENDING' && s.activatedAt !== null && now - s.activatedAt > 45 * 86_400_000 && !db.claim(s.claimId)?.sampleAudit);
    expect(stale).toHaveLength(0);
  });

  it('TC-FE-MK02 401 without a token, 404 for another employee’s claim, 422 validation, worst-line policy', async () => {
    resetMockDb();
    expect((await call('GET', '/me')).status).toBe(401);
    const theirs = (await call('POST', '/claims', { token: 101, body: { title: 'Private' } })).body as { id: number };
    expect((await call('GET', `/claims/${theirs.id}`, { token: 100 })).status).toBe(404);

    const c = (await call('POST', '/claims', { token: 100, body: { title: 'Mock test' } })).body as { id: number };
    expect((await call('POST', `/claims/${c.id}/lines`, { token: 100, body: line({ amount: '0' }) })).status).toBe(422);
    expect((await call('POST', `/claims/${c.id}/lines`, { token: 100, body: { ...line(), status: 'APPROVED' } })).status).toBe(400);
    await call('POST', `/claims/${c.id}/lines`, { token: 100, body: line() });
    const preview = (await call('POST', `/claims/${c.id}/policy-preview`, { token: 100 })).body as { claimOutcome: string };
    expect(preview.claimOutcome).toBe('AUTO_REJECT');
    const detail = (await call('GET', `/claims/${c.id}`, { token: 100 })).body as { version: number };
    const submitted = (await call('POST', `/claims/${c.id}/submit`, { token: 100, body: { version: detail.version } })).body as { status: string };
    expect(submitted.status).toBe('POLICY_REJECTED');
  });

  it('TC-FE-MK03 manager approves with optimistic locking; cannot approve own claim', async () => {
    resetMockDb();
    const inbox = (await call('GET', '/approvals/inbox', { token: 10 })).body as { claimId: number; version: number }[];
    expect(inbox.length).toBeGreaterThan(0);
    const first = inbox[0] as { claimId: number; version: number };
    expect((await call('POST', `/claims/${first.claimId}/approve`, { token: 10, body: { version: first.version - 1 } })).status).toBe(409);
    expect((await call('POST', `/claims/${first.claimId}/approve`, { token: 10, body: { version: first.version } })).status).toBe(200);
    const mine = (await call('POST', '/claims', { token: 10, body: { title: 'Mine' } })).body as { id: number };
    expect((await call('POST', `/claims/${mine.id}/approve`, { token: 10, body: { version: 1 } })).status).not.toBe(200);
  });

  it('TC-FE-MK04 payout lifecycle and CSV control total', async () => {
    resetMockDb();
    const eligible = (await call('GET', '/payouts/eligible', { token: 1 })).body as { id: number }[];
    expect(eligible.length).toBeGreaterThan(0);
    const b = (await call('POST', '/payouts', { token: 1, body: { claimIds: eligible.slice(0, 2).map((e) => e.id) } })).body as { id: number; version: number };
    expect((await call('POST', `/payouts/${b.id}/mark-paid`, { token: 1, body: { version: b.version } })).status).toBe(422);
    const headers = new Headers({ Authorization: 'Bearer mock-1' });
    const csv = await (await mockFetch('GET', `http://localhost/api/payouts/${b.id}/csv`, { headers })).text();
    const rows = csv.trim().split('\n');
    expect(rows.at(-1)?.split(',')[2]).toBe(rows[1]?.split(',')[4]);
    const after = (await call('GET', `/payouts/${b.id}`, { token: 1 })).body as { status: string; version: number };
    expect(after.status).toBe('EXPORTED');
    expect((await call('POST', `/payouts/${b.id}/mark-paid`, { token: 1, body: { version: after.version } })).status).toBe(200);
  });
});
