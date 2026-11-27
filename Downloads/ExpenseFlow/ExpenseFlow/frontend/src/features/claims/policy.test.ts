import { describe, expect, it } from 'vitest';
import { claim, line, result } from '@/test/fixtures';
import { claimFlags, claimHref, isEditable, lineFlags, linePolicies, lineReceiptId, worst } from './policy';

describe('claim policy helpers', () => {
  it('TC-FE-C01 (BR-12) worst outcome wins: AUTO_REJECT > ROUTE > AUTO_APPROVE', () => {
    expect(worst(['AUTO_APPROVE', 'ROUTE'])).toBe('ROUTE');
    expect(worst(['AUTO_APPROVE', 'ROUTE', 'AUTO_REJECT'])).toBe('AUTO_REJECT');
    expect(worst(['AUTO_APPROVE'])).toBe('AUTO_APPROVE');
    expect(worst([null, undefined])).toBeNull();
  });

  it('TC-FE-C02 preview results override persisted ones', () => {
    const c = claim({ lines: [line({ id: 1, lineOutcome: 'AUTO_APPROVE' })], policyResults: [] });
    const map = linePolicies(c, {
      claimOutcome: 'AUTO_REJECT',
      lines: [{ lineId: 1, outcome: 'AUTO_REJECT', results: [result({ ruleCode: 'RECEIPT_REQUIRED', outcome: 'AUTO_REJECT', flag: 'RECEIPT' })] }],
    });
    expect(map.get(1)?.outcome).toBe('AUTO_REJECT');
  });

  it('TC-FE-C03 only the latest evaluation is shown after a resubmit', () => {
    const c = claim({
      lines: [line({ id: 1, lineOutcome: null })],
      policyResults: [result({ evaluationNo: 1, flag: 'WEEKEND' }), result({ evaluationNo: 2, ruleCode: 'CAB_TRIP_LIMIT', flag: 'OVER_LIMIT' })],
    });
    const p = linePolicies(c).get(1);
    expect(p?.results.map((r) => r.ruleCode)).toEqual(['CAB_TRIP_LIMIT']);
    expect(p?.outcome).toBe('ROUTE');
    expect(claimFlags(c)).toEqual(['OVER_LIMIT']);
  });

  it('TC-FE-C04 flags include SAMPLE for sampled claims', () => {
    expect(claimFlags(claim({ sampleAudit: true }))).toContain('SAMPLE');
    expect(lineFlags([result({ flag: 'DUPLICATE' }), result({ flag: 'DUPLICATE' })])).toEqual(['DUPLICATE']);
  });

  it('TC-FE-C05 (BR-01) only DRAFT and SENT_BACK are editable', () => {
    expect(isEditable({ status: 'DRAFT' })).toBe(true);
    expect(isEditable({ status: 'SENT_BACK' })).toBe(true);
    expect(isEditable({ status: 'PENDING_MANAGER' })).toBe(false);
    expect(isEditable({ status: 'POLICY_REJECTED' })).toBe(false);
    expect(claimHref({ id: 5, status: 'DRAFT' })).toBe('/claims/5/edit');
    expect(claimHref({ id: 5, status: 'APPROVED' })).toBe('/claims/5');
  });

  it('TC-FE-C06 receipt id is read from any of the supported shapes', () => {
    expect(lineReceiptId(line({ receipt: { id: 7 } }))).toBe(7);
    expect(lineReceiptId(line({ receipt: null, receiptId: 8 }))).toBe(8);
    expect(lineReceiptId(line({ receipt: null, receiptId: null }))).toBeNull();
  });
});
