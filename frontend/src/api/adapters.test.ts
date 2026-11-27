import { describe, expect, it } from 'vitest';
import { renameKey, toAuditorItem, toClaimDetail, toInboxItem, toMe, toSavedLine } from './adapters';

/** Payloads below mirror the Spring Boot records (ClaimDtos, AuthController, ApprovalController, …). */
const backendDetail = {
  claim: {
    id: 7, claimNo: 'EXP-2026-000007', title: 'Pune trip', status: 'PENDING_MANAGER', totalAmount: 2600.0,
    employeeId: 22, employeeName: 'Ira Bhat', sampleAudit: false, splitSuspect: true, policyOutcome: 'ROUTE',
    cycleNo: 1, submittedAt: '2026-11-27T10:00:00+05:30', approvedAt: null, createdAt: '2026-11-27T09:00:00+05:30',
    version: 3,
  },
  lines: [
    {
      id: 11, category: 'MEAL', amount: 1800.0, expenseDate: '2026-11-26', vendor: 'Cafe', city: 'Pune',
      cityTier: 'TIER_1', nights: null, description: null, lineOutcome: 'ROUTE',
      receipt: { id: 5, originalName: 'r.png', contentType: 'image/png', sizeBytes: 10, sha256: 'ab' },
      policyResults: [{ ruleCode: 'MEAL_DAILY_LIMIT', ruleVersion: 1, outcome: 'ROUTE', flag: 'OVER_LIMIT', reason: 'over', relatedLineId: null, matchClaimId: null, matchClaimNo: null }],
    },
    {
      id: 12, category: 'CAB', amount: 800.0, expenseDate: '2026-11-26', vendor: 'Cab', city: 'Pune',
      cityTier: 'TIER_1', nights: null, description: null, lineOutcome: 'ROUTE', receipt: null,
      policyResults: [{ ruleCode: 'DUPLICATE_VENDOR_AMOUNT_DATE', ruleVersion: 1, outcome: 'ROUTE', flag: 'DUPLICATE', reason: 'dup', relatedLineId: 3, matchClaimId: 2, matchClaimNo: 'EXP-2026-000002' }],
    },
  ],
  steps: [
    { id: 90, seq: 1, level: 'MANAGER', assigneeId: 6, assigneeName: 'Siddharth', assigneeRole: 'MANAGER', status: 'PENDING', actedBy: null, actedByName: null, onBehalfOf: null, onBehalfOfName: null, activatedAt: null, actedAt: null, note: null, cycleNo: 1 },
    { id: 89, seq: 1, level: 'MANAGER', assigneeId: 6, assigneeName: 'Siddharth', assigneeRole: 'MANAGER', status: 'CANCELLED', actedBy: 7, actedByName: 'X', onBehalfOf: 6, onBehalfOfName: 'Siddharth', activatedAt: null, actedAt: null, note: null, cycleNo: 0 },
  ],
  comments: [],
  permissions: { canEdit: false, canSubmit: false, canApprove: true, actingOnBehalfOf: null, canCopy: false },
};

describe('toClaimDetail', () => {
  it('flattens the nested backend detail into the UI shape', () => {
    const d = toClaimDetail(backendDetail);
    expect(d.id).toBe(7);
    expect(d.version).toBe(3);
    expect(d.employeeId).toBe(22);
    expect(d.flags).toEqual(['SPLIT_SUSPECT']);
    expect(d.lines.map((l) => l.id)).toEqual([11, 12]);
    expect(d.lines[0]?.receiptId).toBe(5);
    expect(d.approvalSteps[1]).toMatchObject({ actedById: 7, onBehalfOfId: 6 });
    expect(d.policyResults).toHaveLength(2);
    expect(d.policyResults[1]).toMatchObject({ claimLineId: 12, matchLineId: 3, matchClaimId: 2, matchClaimNo: 'EXP-2026-000002' });
    expect(d.allowedActions).toContain('APPROVE');
  });

  it('only offers COMMENT when the server says the caller cannot approve', () => {
    const d = toClaimDetail({ ...backendDetail, permissions: { ...backendDetail.permissions, canApprove: false } });
    expect(d.allowedActions).toEqual(['COMMENT']);
  });

  it('passes an already-flat detail (mock mode) through unchanged', () => {
    const flat = { id: 1, approvalSteps: [], policyResults: [], lines: [] };
    expect(toClaimDetail(flat)).toBe(flat);
  });
});

describe('toSavedLine', () => {
  it('picks the updated line by id, or the newest line after an add', () => {
    expect(toSavedLine(backendDetail, 11).id).toBe(11);
    expect(toSavedLine(backendDetail).id).toBe(12);
  });
});

describe('other adapters', () => {
  it('maps /me actingFor to active delegations where I am the delegate', () => {
    const me = toMe({ id: 7, name: 'B', roles: ['EMPLOYEE'], actingFor: [{ id: 1, delegatorId: 6, delegatorName: 'A', toDate: '2026-12-01' }] });
    expect(me.activeDelegations).toEqual([
      expect.objectContaining({ delegatorId: 6, delegateId: 7, revoked: false, toDate: '2026-12-01' }),
    ]);
  });

  it('maps inbox and auditor rows', () => {
    expect(toInboxItem({ claimId: 1, claimVersion: 4, onBehalfOf: 6, ageHours: 2, splitSuspect: false })).toMatchObject({
      version: 4, onBehalfOfId: 6, ageSeconds: 7200,
    });
    expect(toAuditorItem({ claimId: 1, pendingSince: '2026-11-27T10:00:00+05:30', ageHours: 1, version: 2 })).toMatchObject({
      activatedAt: '2026-11-27T10:00:00+05:30', ageSeconds: 3600,
    });
  });

  it('renames dashboard keys', () => {
    expect(renameKey('month')({ key: '2026-11', total: 10 })).toEqual({ month: '2026-11', total: 10 });
    expect(renameKey('month')({ month: '2026-11', total: 10 })).toEqual({ month: '2026-11', total: 10 });
  });
});
