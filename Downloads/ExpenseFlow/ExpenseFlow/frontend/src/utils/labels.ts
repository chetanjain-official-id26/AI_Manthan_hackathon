import type {
  ApprovalLevel,
  Category,
  ClaimStatus,
  Flag,
  PayoutStatus,
  PolicyOutcome,
  PolicyResult,
  Role,
} from '@/api/types';
import { formatINR, toPaise } from './money';

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  POLICY_REJECTED: 'Policy rejected',
  PENDING_MANAGER: 'Pending manager',
  PENDING_AUDITOR: 'Pending auditor',
  PENDING_FINANCE_HEAD: 'Pending finance head',
  SENT_BACK: 'Sent back',
  APPROVED: 'Approved',
  IN_PAYOUT: 'In payout',
  PAID: 'Paid',
  REJECTED: 'Rejected',
};

export const ROLE_LABEL: Record<Role, string> = {
  EMPLOYEE: 'Employee',
  MANAGER: 'Manager',
  AUDITOR: 'Auditor',
  FINANCE_HEAD: 'Finance Head',
};

export const LEVEL_LABEL: Record<ApprovalLevel, string> = {
  MANAGER: 'Manager',
  AUDITOR: 'Auditor',
  FINANCE_HEAD: 'Finance Head',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  MEAL: 'Meal',
  HOTEL: 'Hotel',
  CAB: 'Cab',
  OTHER: 'Other',
};

export const OUTCOME_LABEL: Record<PolicyOutcome, string> = {
  AUTO_APPROVE: 'Auto-approve',
  ROUTE: 'Needs approval',
  AUTO_REJECT: 'Auto-reject',
};

export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  DRAFT: 'Draft',
  EXPORTED: 'Exported',
  PAID: 'Paid',
  VOID: 'Void',
};

export const FLAG_LABEL: Record<Flag, string> = {
  OVER_LIMIT: 'Over limit',
  DUPLICATE: 'Duplicate',
  WEEKEND: 'Weekend',
  RECEIPT: 'Receipt',
  SAMPLE: 'Sample',
  SPLIT_SUSPECT: 'Split suspect',
  STALE_EXPENSE: 'Stale expense',
};

export const FLAG_DESCRIPTION: Record<Flag, string> = {
  OVER_LIMIT: 'Amount is above the policy limit for this category',
  DUPLICATE: 'Matches another line (same vendor, amount and date, or the same receipt file)',
  WEEKEND: 'Expense date is a Saturday or Sunday (IST)',
  RECEIPT: 'A receipt is required for this amount',
  SAMPLE: 'Picked at random for the 10% sample audit',
  SPLIT_SUSPECT: 'Combined with recent claims, this crosses an approval threshold',
  STALE_EXPENSE: 'Expense date is more than 90 days before submission',
};

export const FLAGS_FILTERABLE: readonly Flag[] = ['DUPLICATE', 'WEEKEND', 'OVER_LIMIT', 'SPLIT_SUSPECT'];

export const RULE_LABEL: Record<string, string> = {
  MEAL_DAILY_LIMIT: 'Meal daily limit',
  HOTEL_NIGHTLY_LIMIT: 'Hotel nightly limit',
  CAB_TRIP_LIMIT: 'Cab per-trip limit',
  RECEIPT_REQUIRED: 'Receipt required',
  DUPLICATE_VENDOR_AMOUNT_DATE: 'Duplicate (vendor + amount + date)',
  DUPLICATE_RECEIPT_HASH: 'Duplicate receipt file',
  WEEKEND_SPEND: 'Weekend spend',
  STALE_EXPENSE: 'Stale expense (> 90 days)',
  SPLIT_SUSPECT: 'Claim splitting suspected',
};

export function ruleLabel(code: string): string {
  return RULE_LABEL[code] ?? code.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

const UNIT_SUFFIX: Record<string, string> = {
  MEAL_DAILY_LIMIT: ' per day',
  HOTEL_NIGHTLY_LIMIT: ' per night',
  CAB_TRIP_LIMIT: ' per trip',
};

/**
 * Human-readable explanation: rule, limit and actual value.
 * e.g. "Meal daily limit: ₹1,800.00 / ₹1,500.00 per day".
 */
export function explainResult(r: PolicyResult): string {
  if (r.reason && !/^[A-Z_]+$/.test(r.reason)) return r.reason;
  const label = ruleLabel(r.ruleCode);
  if (r.ruleCode === 'RECEIPT_REQUIRED') {
    return `Receipt required above ${formatINR(r.limitAmount ?? '500')}`;
  }
  if (r.ruleCode.startsWith('DUPLICATE')) {
    return r.matchClaimNo ? `${label}: matches ${r.matchClaimNo}` : label;
  }
  if (r.limitAmount !== null && r.limitAmount !== undefined && r.actualAmount !== null && r.actualAmount !== undefined) {
    const over = toPaise(r.actualAmount) > toPaise(r.limitAmount);
    return `${label}: ${formatINR(r.actualAmount)} ${over ? '>' : '≤'} ${formatINR(r.limitAmount)}${UNIT_SUFFIX[r.ruleCode] ?? ''}`;
  }
  return label;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
