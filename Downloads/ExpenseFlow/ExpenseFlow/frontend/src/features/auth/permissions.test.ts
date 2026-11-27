import { describe, expect, it } from 'vitest';
import { AUDITOR, EMPLOYEE, EMPLOYEE_B, FINANCE_HEAD, MANAGER, claim, delegation, step } from '@/test/fixtures';
import { actingFor, actionPermission, hasRole, homePath, isApprover, isDelegationActive, primaryRole } from './permissions';

describe('permissions (client mirror of BR-17/18, LLD §2.1)', () => {
  it('TC-FE-P01 primary role is the highest role held', () => {
    expect(primaryRole(['EMPLOYEE'])).toBe('EMPLOYEE');
    expect(primaryRole(['EMPLOYEE', 'MANAGER'])).toBe('MANAGER');
    expect(primaryRole(['MANAGER', 'FINANCE_HEAD', 'AUDITOR'])).toBe('FINANCE_HEAD');
    expect(primaryRole([])).toBe('EMPLOYEE');
    expect(homePath(EMPLOYEE)).toBe('/home');
  });

  it('TC-FE-P02 manager can act on a reportee claim at the manager step', () => {
    const p = actionPermission(MANAGER, claim());
    expect(p).toMatchObject({ canAct: true, isOwner: false });
  });

  it('TC-FE-P03 (R2) owner can never act on their own claim, even as delegate', () => {
    const me = { ...EMPLOYEE, activeDelegations: [delegation({ delegateId: EMPLOYEE.id })] };
    const p = actionPermission(me, claim());
    expect(p.canAct).toBe(false);
    expect(p.isOwner).toBe(true);
    expect(p.reason).toMatch(/own claim/);
  });

  it('TC-FE-P04 (R2) owner is blocked even if the server hints APPROVE', () => {
    const p = actionPermission(EMPLOYEE, claim({ allowedActions: ['APPROVE'] }));
    expect(p.canAct).toBe(false);
  });

  it('TC-FE-P05 active delegate acts on behalf of the delegator', () => {
    const me = { ...EMPLOYEE_B, activeDelegations: [delegation()] };
    const p = actionPermission(me, claim());
    expect(p).toMatchObject({ canAct: true, onBehalfOf: MANAGER.name });
    expect(isApprover(me)).toBe(true);
  });

  it('TC-FE-P06 expired or revoked delegation gives no rights', () => {
    const expired = { ...EMPLOYEE_B, activeDelegations: [delegation({ toDate: '2001-01-01' })] };
    const revoked = { ...EMPLOYEE_B, activeDelegations: [delegation({ revoked: true })] };
    expect(actionPermission(expired, claim()).canAct).toBe(false);
    expect(actionPermission(revoked, claim()).canAct).toBe(false);
    expect(isDelegationActive(delegation({ fromDate: '2999-01-01' }))).toBe(false);
    expect(actingFor(expired)).toHaveLength(0);
    expect(isApprover(expired)).toBe(false);
  });

  it('TC-FE-P07 (R8) non-assignee sees "waiting for" instead of actions', () => {
    const p = actionPermission(AUDITOR, claim());
    expect(p.canAct).toBe(false);
    expect(p.reason).toMatch(/Waiting for manager/);
  });

  it('TC-FE-P08 any auditor can act on the auditor pool step', () => {
    const c = claim({ status: 'PENDING_AUDITOR', approvalSteps: [step({ status: 'APPROVED' }), step({ id: 2, seq: 2, level: 'AUDITOR', assigneeId: null, assigneeName: null })] });
    expect(actionPermission(AUDITOR, c).canAct).toBe(true);
    expect(actionPermission(MANAGER, c).canAct).toBe(false);
  });

  it('TC-FE-P09 finance head step and non-pending claims', () => {
    const c = claim({ status: 'PENDING_FINANCE_HEAD', approvalSteps: [step({ id: 3, seq: 3, level: 'FINANCE_HEAD', assigneeId: FINANCE_HEAD.id })] });
    expect(actionPermission(FINANCE_HEAD, c).canAct).toBe(true);
    expect(actionPermission(MANAGER, claim({ status: 'APPROVED', approvalSteps: [step({ status: 'APPROVED' })] })).reason).toMatch(/not waiting/);
  });

  it('TC-FE-P10 uses the latest cycle after a send-back', () => {
    const c = claim({
      approvalSteps: [step({ id: 1, cycleNo: 1, status: 'CANCELLED' }), step({ id: 9, cycleNo: 2, status: 'PENDING', assigneeId: MANAGER.id })],
    });
    expect(actionPermission(MANAGER, c).canAct).toBe(true);
  });

  it('TC-FE-P11 role helpers', () => {
    expect(hasRole(FINANCE_HEAD, 'AUDITOR', 'FINANCE_HEAD')).toBe(true);
    expect(hasRole(EMPLOYEE, 'MANAGER')).toBe(false);
    expect(hasRole(null, 'EMPLOYEE')).toBe(false);
    expect(isApprover(EMPLOYEE)).toBe(false);
  });
});
