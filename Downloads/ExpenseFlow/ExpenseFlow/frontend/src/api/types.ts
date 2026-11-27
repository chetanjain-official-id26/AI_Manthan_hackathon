/**
 * DTOs for the ExpenseFlow REST API (`/api`), derived from docs/02-LLD.md §4 and §6.
 * Money arrives from Spring as a JSON number or string (BigDecimal); never do float
 * arithmetic on it — use utils/money.ts (integer paise).
 */

export type Money = number | string;

export type Role = 'EMPLOYEE' | 'MANAGER' | 'AUDITOR' | 'FINANCE_HEAD';
export const ROLES: readonly Role[] = ['EMPLOYEE', 'MANAGER', 'AUDITOR', 'FINANCE_HEAD'];

export type ClaimStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'POLICY_REJECTED'
  | 'PENDING_MANAGER'
  | 'PENDING_AUDITOR'
  | 'PENDING_FINANCE_HEAD'
  | 'SENT_BACK'
  | 'APPROVED'
  | 'IN_PAYOUT'
  | 'PAID'
  | 'REJECTED';

export const CLAIM_STATUSES: readonly ClaimStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'POLICY_REJECTED',
  'PENDING_MANAGER',
  'PENDING_AUDITOR',
  'PENDING_FINANCE_HEAD',
  'SENT_BACK',
  'APPROVED',
  'IN_PAYOUT',
  'PAID',
  'REJECTED',
];

export type Category = 'MEAL' | 'HOTEL' | 'CAB' | 'OTHER';
export const CATEGORIES: readonly Category[] = ['MEAL', 'HOTEL', 'CAB', 'OTHER'];

export type CityTier = 'TIER_1' | 'OTHER';
export type PolicyOutcome = 'AUTO_APPROVE' | 'ROUTE' | 'AUTO_REJECT';

export type Flag =
  | 'OVER_LIMIT'
  | 'DUPLICATE'
  | 'WEEKEND'
  | 'RECEIPT'
  | 'SAMPLE'
  | 'SPLIT_SUSPECT'
  | 'STALE_EXPENSE';

export type ApprovalLevel = 'MANAGER' | 'AUDITOR' | 'FINANCE_HEAD';
export type StepStatus = 'WAITING' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'SENT_BACK' | 'CANCELLED';
export type ClaimAction = 'APPROVE' | 'REJECT' | 'SEND_BACK' | 'COMMENT';

/** Spring Data page. Both the legacy `Page` and the newer `PagedModel` shapes are normalised in client.ts. */
export interface Page<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

// ---------- RFC 7807 ----------
export interface ProblemFieldError {
  field?: string;
  name?: string;
  message?: string;
  reason?: string;
}

export interface ProblemDetail {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
  code?: string;
  errors?: ProblemFieldError[] | Record<string, string>;
  fieldErrors?: ProblemFieldError[] | Record<string, string>;
  invalidParams?: ProblemFieldError[];
}

// ---------- Auth / users ----------
export interface UserSummary {
  id: number;
  empCode?: string;
  name: string;
  email?: string;
  department?: string;
  departmentName?: string;
  roles: Role[];
  managerId?: number | null;
}

export type DemoUser = UserSummary;

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: UserSummary;
}

export interface Delegation {
  id: number;
  delegatorId: number;
  delegatorName?: string;
  delegateId: number;
  delegateName?: string;
  fromDate: string;
  toDate: string;
  reason?: string;
  revoked: boolean;
  createdAt?: string;
}

export interface Me extends UserSummary {
  /** Active delegations involving the user, as delegator or delegate. */
  activeDelegations?: Delegation[];
}

// ---------- Claims ----------
export interface ClaimSummary {
  id: number;
  claimNo: string;
  title: string;
  status: ClaimStatus;
  totalAmount: Money;
  lineCount?: number;
  submittedAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  lastAction?: string | null;
  employeeId?: number;
  employeeName?: string;
  department?: string;
  version: number;
  flags?: Flag[];
}

export interface Receipt {
  id: number;
  receiptId?: number;
  originalName?: string;
  contentType?: string;
  sizeBytes?: number;
  sha256?: string;
  uploadedAt?: string;
}

export interface ClaimLine {
  id: number;
  category: Category;
  amount: Money;
  expenseDate: string;
  vendor: string;
  city?: string | null;
  cityTier?: CityTier | null;
  nights?: number | null;
  description?: string | null;
  lineOutcome?: PolicyOutcome | null;
  receipt?: Receipt | null;
  receiptId?: number | null;
}

export interface LineInput {
  category: Category;
  amount: string;
  expenseDate: string;
  vendor: string;
  city: string;
  cityTier: CityTier;
  nights: number | null;
  description: string;
}

export interface PolicyResult {
  id?: number;
  claimLineId: number;
  ruleId?: number;
  ruleCode: string;
  ruleVersion?: number;
  outcome: PolicyOutcome;
  flag?: Flag | null;
  reason?: string | null;
  limitAmount?: Money | null;
  actualAmount?: Money | null;
  matchClaimId?: number | null;
  matchClaimNo?: string | null;
  matchLineId?: number | null;
  evaluationNo?: number;
  evaluatedAt?: string;
}

export interface ApprovalStep {
  id: number;
  seq: number;
  level: ApprovalLevel;
  assigneeId?: number | null;
  assigneeName?: string | null;
  assigneeRole?: Role | null;
  status: StepStatus;
  actedById?: number | null;
  actedByName?: string | null;
  onBehalfOfId?: number | null;
  onBehalfOfName?: string | null;
  actedAt?: string | null;
  activatedAt?: string | null;
  note?: string | null;
  cycleNo?: number;
}

export interface ClaimComment {
  id: number;
  authorId: number;
  authorName?: string;
  body: string;
  createdAt: string;
}

export interface ClaimDetail extends ClaimSummary {
  employeeId: number;
  employeeName?: string;
  department?: string;
  sampleAudit?: boolean;
  policyOutcome?: PolicyOutcome | null;
  approvedAt?: string | null;
  lines: ClaimLine[];
  policyResults: PolicyResult[];
  approvalSteps: ApprovalStep[];
  comments: ClaimComment[];
  /** Optional server hint; the UI still applies its own self-approval guard. */
  allowedActions?: ClaimAction[];
}

export interface LinePreview {
  lineId: number;
  outcome: PolicyOutcome;
  results: PolicyResult[];
}

export interface PolicyPreviewResponse {
  claimOutcome: PolicyOutcome;
  lines: LinePreview[];
}

export interface ReceiptUploadResponse {
  receiptId: number;
  sha256: string;
}

// ---------- Approvals ----------
export interface InboxItem {
  stepId?: number;
  claimId: number;
  claimNo: string;
  employeeId?: number;
  employeeName: string;
  department?: string;
  totalAmount: Money;
  flags?: Flag[];
  level: ApprovalLevel;
  activatedAt?: string | null;
  ageSeconds?: number | null;
  onBehalfOfId?: number | null;
  onBehalfOfName?: string | null;
  sampleAudit?: boolean;
  version: number;
}

// ---------- Auditor ----------
export interface AuditorQueueItem {
  claimId: number;
  claimNo: string;
  employeeId?: number;
  employeeName: string;
  department?: string;
  lineCount?: number;
  totalAmount: Money;
  flags?: Flag[];
  sampleAudit?: boolean;
  managerApprovedBy?: string | null;
  activatedAt?: string | null;
  ageSeconds?: number | null;
  status?: ClaimStatus;
  version: number;
}

export type QueueSort = 'age' | '-age' | 'amount' | '-amount';

export interface AuditorQueueFilters {
  dept?: string;
  category?: Category | '';
  min?: string;
  max?: string;
  flag?: Flag | '';
  sample?: boolean;
  ageDays?: string;
  sort?: QueueSort;
  page?: number;
}

export interface BulkApproveResult {
  claimId: number;
  result: string;
  error?: string | null;
}

// ---------- Payouts ----------
export type PayoutStatus = 'DRAFT' | 'EXPORTED' | 'PAID' | 'VOID';

export interface PayoutItem {
  id?: number;
  claimId: number;
  claimNo?: string;
  employeeId: number;
  employeeName?: string;
  empCode?: string;
  amount: Money;
}

export interface PayoutBatch {
  id: number;
  batchNo: string;
  status: PayoutStatus;
  claimCount: number;
  employeeCount?: number;
  totalAmount: Money;
  fileName?: string | null;
  fileSha256?: string | null;
  createdAt?: string;
  createdByName?: string;
  exportedAt?: string | null;
  paidAt?: string | null;
  voidReason?: string | null;
  version: number;
  items?: PayoutItem[];
}

// ---------- Dashboard ----------
export interface SpendByCategory {
  category: Category | string;
  total: Money;
}
export interface SpendByDepartment {
  department: string;
  total: Money;
}
export interface SpendByMonth {
  month: string;
  total: Money;
}
export interface ViolationCount {
  ruleCode: string;
  count: number;
}
export interface ApprovalTime {
  department: string;
  avgHours: number;
}
export interface DashboardKpis {
  pendingClaims?: number;
  oldestPendingSeconds?: number | null;
}

// ---------- Audit ----------
export interface AuditEvent {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  actorId?: number | null;
  actorName?: string | null;
  onBehalfOfId?: number | null;
  onBehalfOfName?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
  ip?: string | null;
  createdAt: string;
}

// ---------- Policy rules ----------
export type RuleUnit = 'PER_DAY' | 'PER_NIGHT' | 'PER_TRIP' | 'PER_LINE' | 'NONE';

export interface PolicyRule {
  id: number;
  ruleCode: string;
  category?: Category | null;
  cityTier?: CityTier | null;
  limitAmount?: Money | null;
  unit: RuleUnit;
  action: PolicyOutcome;
  flag?: Flag | null;
  params?: Record<string, unknown> | null;
  active: boolean;
  version: number;
  effectiveFrom: string;
  createdByName?: string | null;
  createdAt?: string;
  reason?: string | null;
}

export interface PolicyRuleVersionInput {
  limitAmount: string | null;
  action: PolicyOutcome;
  active: boolean;
  effectiveFrom: string;
  reason: string;
  category?: Category | null;
  cityTier?: CityTier | null;
}
