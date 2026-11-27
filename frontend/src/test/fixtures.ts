import type {
  ApprovalStep,
  AuditorQueueItem,
  ClaimDetail,
  ClaimLine,
  Delegation,
  InboxItem,
  Me,
  Page,
  PayoutBatch,
  PolicyResult,
  PolicyRule,
} from '@/api/types';

// ---- personas (synthetic) ----
export const EMPLOYEE: Me = { id: 101, name: 'Ananya Rao', department: 'Sales', roles: ['EMPLOYEE'], managerId: 201, activeDelegations: [] };
export const EMPLOYEE_B: Me = { id: 102, name: 'Rohit Verma', department: 'Sales', roles: ['EMPLOYEE'], managerId: 201, activeDelegations: [] };
export const MANAGER: Me = { id: 201, name: 'Meera Iyer', department: 'Sales', roles: ['EMPLOYEE', 'MANAGER'], activeDelegations: [] };
export const AUDITOR: Me = { id: 301, name: 'Kabir Shah', department: 'Finance', roles: ['EMPLOYEE', 'AUDITOR'], activeDelegations: [] };
export const FINANCE_HEAD: Me = { id: 401, name: 'Priya Nair', department: 'Finance', roles: ['EMPLOYEE', 'FINANCE_HEAD'], activeDelegations: [] };

export const ALL_USERS = [EMPLOYEE, EMPLOYEE_B, MANAGER, AUDITOR, FINANCE_HEAD];

export function delegation(over: Partial<Delegation> = {}): Delegation {
  return {
    id: 1,
    delegatorId: MANAGER.id,
    delegatorName: MANAGER.name,
    delegateId: EMPLOYEE_B.id,
    delegateName: EMPLOYEE_B.name,
    fromDate: '2000-01-01',
    toDate: '2999-12-31',
    reason: 'Annual leave',
    revoked: false,
    ...over,
  };
}

export function line(over: Partial<ClaimLine> = {}): ClaimLine {
  return {
    id: 1,
    category: 'MEAL',
    amount: '1200.00',
    expenseDate: '2026-11-10',
    vendor: 'Hotel Sagar',
    city: 'Pune',
    cityTier: 'TIER_1',
    nights: null,
    description: 'Client dinner',
    lineOutcome: 'AUTO_APPROVE',
    receipt: { id: 9001, originalName: 'dinner.jpg', contentType: 'image/jpeg', sha256: 'ab'.repeat(32) },
    ...over,
  };
}

export function step(over: Partial<ApprovalStep> = {}): ApprovalStep {
  return {
    id: 1,
    seq: 1,
    level: 'MANAGER',
    assigneeId: MANAGER.id,
    assigneeName: MANAGER.name,
    status: 'PENDING',
    activatedAt: new Date(Date.now() - 50 * 3600 * 1000).toISOString(),
    cycleNo: 1,
    ...over,
  };
}

export function result(over: Partial<PolicyResult> = {}): PolicyResult {
  return { claimLineId: 1, ruleCode: 'WEEKEND_SPEND', outcome: 'ROUTE', flag: 'WEEKEND', reason: null, evaluationNo: 1, ...over };
}

export function claim(over: Partial<ClaimDetail> = {}): ClaimDetail {
  return {
    id: 501,
    claimNo: 'CLM-2026-0501',
    title: 'Client visit Pune',
    status: 'PENDING_MANAGER',
    totalAmount: '18000.00',
    version: 3,
    employeeId: EMPLOYEE.id,
    employeeName: EMPLOYEE.name,
    department: 'Sales',
    submittedAt: '2026-11-25T05:00:00Z',
    policyOutcome: 'ROUTE',
    lines: [line()],
    policyResults: [result()],
    approvalSteps: [step()],
    comments: [],
    ...over,
  };
}

export function inboxItem(over: Partial<InboxItem> = {}): InboxItem {
  return {
    claimId: 501,
    claimNo: 'CLM-2026-0501',
    employeeName: EMPLOYEE.name,
    department: 'Sales',
    totalAmount: '18000.00',
    flags: ['WEEKEND'],
    level: 'MANAGER',
    ageSeconds: 3600,
    version: 3,
    ...over,
  };
}

export function queueItem(over: Partial<AuditorQueueItem> = {}): AuditorQueueItem {
  return {
    claimId: 601,
    claimNo: 'CLM-2026-0601',
    employeeId: EMPLOYEE.id,
    employeeName: EMPLOYEE.name,
    department: 'Sales',
    lineCount: 2,
    totalAmount: '30000.00',
    flags: [],
    sampleAudit: false,
    ageSeconds: 7200,
    status: 'PENDING_AUDITOR',
    version: 2,
    ...over,
  };
}

export function batch(over: Partial<PayoutBatch> = {}): PayoutBatch {
  return {
    id: 12,
    batchNo: 'B12',
    status: 'CREATED',
    claimCount: 3,
    employeeCount: 2,
    totalAmount: '48250.00',
    fileName: null,
    createdAt: '2026-11-27T06:00:00Z',
    version: 1,
    items: [
      { claimId: 1, claimNo: 'CLM-2026-0101', employeeId: 42, employeeName: 'Ananya Rao', empCode: 'EMP0042', amount: '10000.00' },
      { claimId: 2, claimNo: 'CLM-2026-0107', employeeId: 42, employeeName: 'Ananya Rao', empCode: 'EMP0042', amount: '8250.00' },
      { claimId: 3, claimNo: 'CLM-2026-0115', employeeId: 77, employeeName: 'Rohit Verma', empCode: 'EMP0077', amount: '30000.00' },
    ],
    ...over,
  };
}

export function rule(over: Partial<PolicyRule> = {}): PolicyRule {
  return {
    id: 1,
    ruleCode: 'MEAL_DAILY_LIMIT',
    category: 'MEAL',
    cityTier: null,
    limitAmount: '1500.00',
    unit: 'PER_DAY',
    action: 'ROUTE',
    flag: 'OVER_LIMIT',
    active: true,
    version: 1,
    effectiveFrom: '2026-01-01T00:00:00+05:30',
    ...over,
  };
}

export function page<T>(content: T[], over: Partial<Page<T>> = {}): Page<T> {
  return { content, page: 0, size: 50, totalElements: content.length, totalPages: 1, ...over };
}
