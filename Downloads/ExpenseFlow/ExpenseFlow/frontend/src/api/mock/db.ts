/**
 * In-memory stand-in for the ExpenseFlow backend, used only in demo mock mode.
 * It follows the business rules in CLAUDE.md §3 and the LLD so the UI behaves realistically:
 * versioned policy rules, worst-line outcome, threshold chain snapshots, delegation, self-approval guard,
 * optimistic locking, payouts and an append-only audit trail. All data is synthetic.
 */
import type {
  ApprovalLevel,
  Category,
  CityTier,
  ClaimStatus,
  Flag,
  PayoutStatus,
  PolicyOutcome,
  PolicyResult,
  PolicyRule,
  Role,
  StepStatus,
} from '../types';
import { fromPaise, toPaise } from '@/utils/money';
import { cityTierFor } from '@/utils/cities';
import { dayOfWeekIST } from '@/utils/time';

// ---------------------------------------------------------------- utils
export const DAY = 86_400_000;
export const HOUR = 3_600_000;
const IST_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
export const istDate = (ms: number) => IST_FMT.format(new Date(ms));
export const iso = (ms: number | null | undefined) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());

export class MockError extends Error {
  readonly status: number;
  readonly errors?: { field: string; message: string }[];
  constructor(status: number, message: string, errors?: { field: string; message: string }[]) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic 256-bit digest (hex) — stands in for SHA-256 without needing a secure context. */
export function digestHex(input: Uint8Array | string): string {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let out = '';
  for (let s = 0; s < 4; s += 1) {
    let h1 = 0xdeadbeef ^ Math.imul(s + 1, 0x9e3779b1);
    let h2 = 0x41c6ce57 ^ Math.imul(s + 7, 0x85ebca6b);
    for (let i = 0; i < data.length; i += 1) {
      const ch = data[i] ?? 0;
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    out += (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  return out;
}

export const normVendor = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c);

/** A synthetic receipt image (SVG). Same inputs → same bytes → same digest (used to plant duplicates). */
export function receiptSvg(vendor: string, amount: string, date: string, category: Category, ref: string): string {
  const total = `₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const tax = (Number(amount) * 0.05).toFixed(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="520" viewBox="0 0 360 520">
<rect width="360" height="520" fill="#f8fafc"/><rect x="20" y="16" width="320" height="488" rx="6" fill="#ffffff" stroke="#e2e8f0"/>
<text x="180" y="64" font-family="monospace" font-size="20" font-weight="700" text-anchor="middle" fill="#0f172a">${xml(vendor.toUpperCase().slice(0, 22))}</text>
<text x="180" y="88" font-family="monospace" font-size="11" text-anchor="middle" fill="#64748b">TAX INVOICE · ${xml(category)}</text>
<line x1="40" y1="104" x2="320" y2="104" stroke="#cbd5e1" stroke-dasharray="4 4"/>
<text x="40" y="132" font-family="monospace" font-size="12" fill="#334155">Date: ${xml(date)}</text>
<text x="40" y="152" font-family="monospace" font-size="12" fill="#334155">Ref : ${xml(ref)}</text>
<text x="40" y="196" font-family="monospace" font-size="12" fill="#334155">Item</text><text x="320" y="196" font-family="monospace" font-size="12" text-anchor="end" fill="#334155">Amount</text>
<text x="40" y="222" font-family="monospace" font-size="12" fill="#0f172a">${xml(category.toLowerCase())} charges</text><text x="320" y="222" font-family="monospace" font-size="12" text-anchor="end" fill="#0f172a">${xml(total)}</text>
<text x="40" y="244" font-family="monospace" font-size="11" fill="#64748b">incl. GST 5%</text><text x="320" y="244" font-family="monospace" font-size="11" text-anchor="end" fill="#64748b">₹${tax}</text>
<line x1="40" y1="270" x2="320" y2="270" stroke="#cbd5e1" stroke-dasharray="4 4"/>
<text x="40" y="300" font-family="monospace" font-size="16" font-weight="700" fill="#0f172a">TOTAL</text><text x="320" y="300" font-family="monospace" font-size="16" font-weight="700" text-anchor="end" fill="#0f172a">${xml(total)}</text>
<text x="180" y="440" font-family="monospace" font-size="11" text-anchor="middle" fill="#94a3b8">Synthetic receipt · ExpenseFlow demo</text>
<text x="180" y="460" font-family="monospace" font-size="11" text-anchor="middle" fill="#94a3b8">Thank you!</text></svg>`;
}

// ---------------------------------------------------------------- records
export interface MUser {
  id: number;
  empCode: string;
  name: string;
  email: string;
  department: string;
  roles: Role[];
  managerId: number | null;
  bankAccountMasked: string;
  ifsc: string;
}
export interface MClaim {
  id: number;
  claimNo: string;
  title: string;
  status: ClaimStatus;
  employeeId: number;
  version: number;
  sampleAudit: boolean;
  policyOutcome: PolicyOutcome | null;
  flags: Flag[];
  submittedAt: number | null;
  approvedAt: number | null;
  createdAt: number;
  updatedAt: number;
  lastAction: string;
}
export interface MLine {
  id: number;
  claimId: number;
  category: Category;
  amount: string;
  expenseDate: string;
  vendor: string;
  city: string;
  cityTier: CityTier;
  nights: number | null;
  description: string;
  lineOutcome: PolicyOutcome | null;
  receiptId: number | null;
}
export interface MReceipt {
  id: number;
  lineId: number;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: number;
  blob: Blob;
}
export interface MResult extends PolicyResult {
  id: number;
  claimId: number;
}
export interface MStep {
  id: number;
  claimId: number;
  seq: number;
  level: ApprovalLevel;
  assigneeId: number | null;
  status: StepStatus;
  actedById: number | null;
  onBehalfOfId: number | null;
  actedAt: number | null;
  activatedAt: number | null;
  note: string | null;
  cycleNo: number;
}
export interface MComment {
  id: number;
  claimId: number;
  authorId: number;
  body: string;
  createdAt: number;
}
export interface MAudit {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  actorId: number | null;
  onBehalfOfId: number | null;
  before: unknown;
  after: unknown;
  createdAt: number;
  claimId: number | null;
  requestId: string;
}
export interface MDelegation {
  id: number;
  delegatorId: number;
  delegateId: number;
  fromDate: string;
  toDate: string;
  reason: string;
  revoked: boolean;
  createdAt: number;
}
export interface MBatch {
  id: number;
  batchNo: string;
  status: PayoutStatus;
  createdAt: number;
  createdById: number;
  exportedAt: number | null;
  paidAt: number | null;
  fileName: string | null;
  fileSha256: string | null;
  voidReason: string | null;
  version: number;
  items: { claimId: number; employeeId: number; amount: string }[];
}
export interface MRule extends PolicyRule {
  createdAt: string;
  createdById: number | null;
}

// Config (what the backend keeps in app_config / approval_threshold; rules are seeded in seed.ts).
const APP_CONFIG = { autoApproveMaxTotal: '5000.00', sampleAuditRate: 0.1, staleDays: 90, splitWindowDays: 7 };
const THRESHOLDS: { level: ApprovalLevel; seq: number; minExclusive: string }[] = [
  { level: 'MANAGER', seq: 1, minExclusive: '0.00' },
  { level: 'AUDITOR', seq: 2, minExclusive: '25000.00' },
  { level: 'FINANCE_HEAD', seq: 3, minExclusive: '100000.00' },
];
const LEVEL_ROLE: Record<ApprovalLevel, Role> = { MANAGER: 'MANAGER', AUDITOR: 'AUDITOR', FINANCE_HEAD: 'FINANCE_HEAD' };
const RANK: Record<PolicyOutcome, number> = { AUTO_APPROVE: 0, ROUTE: 1, AUTO_REJECT: 2 };
export const worstOf = (xs: PolicyOutcome[]): PolicyOutcome => xs.reduce<PolicyOutcome>((w, o) => (RANK[o] > RANK[w] ? o : w), 'AUTO_APPROVE');

const IN_FLIGHT: ClaimStatus[] = ['SUBMITTED', 'PENDING_MANAGER', 'PENDING_AUDITOR', 'PENDING_FINANCE_HEAD'];
const DEAD: ClaimStatus[] = ['DRAFT', 'POLICY_REJECTED', 'REJECTED'];

export interface LineEval {
  lineId: number;
  outcome: PolicyOutcome;
  results: PolicyResult[];
}

// ---------------------------------------------------------------- database + engine
export class MockDb {
  users: MUser[] = [];
  claims: MClaim[] = [];
  lines: MLine[] = [];
  receipts: MReceipt[] = [];
  results: MResult[] = [];
  steps: MStep[] = [];
  comments: MComment[] = [];
  audit: MAudit[] = [];
  delegations: MDelegation[] = [];
  rules: MRule[] = [];
  batches: MBatch[] = [];
  private seq = new Map<string, number>();
  private sampler = mulberry32(4242);

  nextId(kind: string, start = 1): number {
    const n = (this.seq.get(kind) ?? start - 1) + 1;
    this.seq.set(kind, n);
    return n;
  }

  // ---------- lookups ----------
  user(id: number | null | undefined): MUser | undefined {
    return id === null || id === undefined ? undefined : this.users.find((u) => u.id === id);
  }
  name(id: number | null | undefined): string | null {
    return this.user(id)?.name ?? null;
  }
  claim(id: number): MClaim | undefined {
    return this.claims.find((c) => c.id === id);
  }
  linesOf(claimId: number): MLine[] {
    return this.lines.filter((l) => l.claimId === claimId).sort((a, b) => a.expenseDate.localeCompare(b.expenseDate) || a.id - b.id);
  }
  stepsOf(claimId: number): MStep[] {
    return this.steps.filter((s) => s.claimId === claimId).sort((a, b) => a.cycleNo - b.cycleNo || a.seq - b.seq);
  }
  total(claimId: number): string {
    return fromPaise(this.linesOf(claimId).reduce((s, l) => s + toPaise(l.amount), 0));
  }
  hasRole(u: MUser, ...roles: Role[]): boolean {
    return roles.some((r) => u.roles.includes(r));
  }
  currentStep(claimId: number): MStep | undefined {
    return this.stepsOf(claimId).find((s) => s.status === 'PENDING');
  }

  // ---------- audit (append-only) ----------
  log(e: Omit<MAudit, 'id' | 'requestId'>): void {
    this.audit.push({ ...e, id: this.nextId('audit'), requestId: `req-${Math.floor(e.createdAt / 1000).toString(36)}-${this.audit.length}` });
  }

  // ---------- delegation ----------
  isActive(d: MDelegation, at: number): boolean {
    const today = istDate(at);
    return !d.revoked && d.fromDate <= today && today <= d.toDate;
  }
  activeDelegationsInvolving(userId: number, at: number): MDelegation[] {
    return this.delegations.filter((d) => (d.delegateId === userId || d.delegatorId === userId) && this.isActive(d, at));
  }

  /** Can `actor` act on `step`? Returns on-behalf-of id when acting as a delegate. Delegation never chains (BR-19). */
  stepActor(step: MStep, actor: MUser, at: number): { ok: boolean; onBehalfOf: number | null } {
    if (step.assigneeId === actor.id) return { ok: true, onBehalfOf: null };
    if (step.assigneeId === null && actor.roles.includes(LEVEL_ROLE[step.level])) return { ok: true, onBehalfOf: null };
    for (const d of this.delegations) {
      if (d.delegateId !== actor.id || !this.isActive(d, at)) continue;
      if (step.assigneeId !== null && d.delegatorId === step.assigneeId) return { ok: true, onBehalfOf: d.delegatorId };
      if (step.assigneeId === null && this.user(d.delegatorId)?.roles.includes(LEVEL_ROLE[step.level])) return { ok: true, onBehalfOf: d.delegatorId };
    }
    return { ok: false, onBehalfOf: null };
  }

  /** BR-26: owner; auditor/finance head; owner's manager; or anyone who can act on its pending step. */
  canView(u: MUser, c: MClaim, at: number): boolean {
    if (c.employeeId === u.id) return true;
    if (this.hasRole(u, 'AUDITOR', 'FINANCE_HEAD')) return true;
    if (c.status === 'DRAFT') return false;
    const owner = this.user(c.employeeId);
    if (owner?.managerId === u.id) return true;
    const step = this.currentStep(c.id);
    return !!step && this.stepActor(step, u, at).ok;
  }

  // ---------- policy rules (versioned config) ----------
  slot(r: Pick<PolicyRule, 'ruleCode' | 'category' | 'cityTier'>): string {
    return `${r.ruleCode}|${r.category ?? ''}|${r.cityTier ?? ''}`;
  }
  activeRules(at: number): MRule[] {
    const bySlot = new Map<string, MRule>();
    for (const r of this.rules) {
      if (Date.parse(r.effectiveFrom) > at) continue;
      const k = this.slot(r);
      const cur = bySlot.get(k);
      if (!cur || r.version > cur.version) bySlot.set(k, r);
    }
    return [...bySlot.values()].filter((r) => r.active);
  }
  addRuleVersion(input: Omit<MRule, 'id' | 'version' | 'createdAt'>, at: number): MRule {
    const sameSlot = this.rules.filter((r) => this.slot(r) === this.slot(input));
    const version = sameSlot.reduce((m, r) => Math.max(m, r.version), 0) + 1;
    const before = sameSlot.find((r) => r.active) ?? null;
    for (const r of sameSlot) r.active = false;
    const rule: MRule = { ...input, id: this.nextId('rule'), version, createdAt: new Date(at).toISOString() };
    this.rules.push(rule);
    if (version > 1) {
      this.log({ entityType: 'POLICY_RULE', entityId: rule.id, action: 'POLICY_RULE_CHANGED', actorId: input.createdById, onBehalfOfId: null, before, after: rule, createdAt: at, claimId: null });
    }
    return rule;
  }

  // ---------- policy engine (LLD §7) ----------
  evaluate(c: MClaim, at: number): { claimOutcome: PolicyOutcome; lines: LineEval[] } {
    const rules = this.activeRules(at);
    const find = (code: string, category?: Category | null, tier?: CityTier | null) =>
      rules.find((r) => r.ruleCode === code && (r.category == null || r.category === category) && (r.cityTier == null || r.cityTier === tier));
    const lines = this.linesOf(c.id);
    const otherLines = this.lines.filter((l) => {
      if (l.claimId === c.id) return false;
      const oc = this.claim(l.claimId);
      return !!oc && oc.employeeId === c.employeeId && !DEAD.includes(oc.status);
    });
    const today = istDate(at);
    const out: LineEval[] = [];

    for (const line of lines) {
      const res: PolicyResult[] = [];
      const push = (r: MRule | undefined, extra: Partial<PolicyResult> = {}) => {
        if (!r || r.action === 'AUTO_APPROVE') return;
        res.push({ claimLineId: line.id, ruleId: r.id, ruleCode: r.ruleCode, ruleVersion: r.version, outcome: r.action, flag: r.flag ?? null, reason: null, limitAmount: r.limitAmount ?? null, ...extra });
      };
      const amt = toPaise(line.amount);

      const receiptRule = find('RECEIPT_REQUIRED');
      if (receiptRule?.limitAmount != null && amt > toPaise(receiptRule.limitAmount) && !line.receiptId) {
        push(receiptRule, { reason: 'RECEIPT_REQUIRED', actualAmount: line.amount });
      }

      const receipt = line.receiptId ? this.receipts.find((r) => r.id === line.receiptId) : undefined;
      if (receipt) {
        const match = this.receipts.find((r) => {
          if (r.id === receipt.id || r.sha256 !== receipt.sha256) return false;
          const ml = this.lines.find((l) => l.id === r.lineId);
          if (!ml) return false;
          if (ml.claimId === c.id) return ml.id < line.id;
          const mc = this.claim(ml.claimId);
          return !!mc && mc.status !== 'DRAFT';
        });
        if (match) {
          const ml = this.lines.find((l) => l.id === match.lineId);
          const mc = ml ? this.claim(ml.claimId) : undefined;
          push(find('DUPLICATE_RECEIPT_HASH'), { matchClaimId: mc?.id ?? null, matchClaimNo: mc?.claimNo ?? null, matchLineId: ml?.id ?? null });
        }
      }

      const vad = [...otherLines, ...lines.filter((l) => l.id < line.id)].find(
        (l) => l.vendor && normVendor(l.vendor) === normVendor(line.vendor) && toPaise(l.amount) === amt && l.expenseDate === line.expenseDate,
      );
      if (vad) {
        const mc = this.claim(vad.claimId);
        push(find('DUPLICATE_VENDOR_AMOUNT_DATE'), { matchClaimId: mc?.id ?? null, matchClaimNo: mc?.claimNo ?? null, matchLineId: vad.id });
      }

      if (line.category === 'MEAL') {
        const r = find('MEAL_DAILY_LIMIT', 'MEAL');
        if (r?.limitAmount != null) {
          const sameDay = [...lines, ...otherLines].filter((l) => l.category === 'MEAL' && l.expenseDate === line.expenseDate);
          const sum = sameDay.reduce((s, l) => s + toPaise(l.amount), 0);
          if (sum > toPaise(r.limitAmount)) push(r, { actualAmount: fromPaise(sum) });
        }
      }
      if (line.category === 'HOTEL') {
        const r = find('HOTEL_NIGHTLY_LIMIT', 'HOTEL', line.cityTier);
        const nights = Math.max(1, line.nights ?? 1);
        const perNight = Math.round(amt / nights);
        if (r?.limitAmount != null && perNight > toPaise(r.limitAmount)) push(r, { actualAmount: fromPaise(perNight) });
      }
      if (line.category === 'CAB') {
        const r = find('CAB_TRIP_LIMIT', 'CAB');
        if (r?.limitAmount != null && amt > toPaise(r.limitAmount)) push(r, { actualAmount: line.amount });
      }
      const dow = dayOfWeekIST(line.expenseDate);
      if (dow === 0 || dow === 6) push(find('WEEKEND_SPEND'));
      const ageDays = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${line.expenseDate}T00:00:00Z`)) / DAY);
      if (ageDays > APP_CONFIG.staleDays) push(find('STALE_EXPENSE'), { reason: `Expense is ${ageDays} days old (limit ${APP_CONFIG.staleDays})` });

      out.push({ lineId: line.id, outcome: worstOf(res.map((r) => r.outcome)), results: res });
    }
    return { claimOutcome: worstOf(out.map((l) => l.outcome)), lines: out };
  }

  // ---------- state machine (LLD §2) ----------
  private setStatus(c: MClaim, to: ClaimStatus, actorId: number | null, at: number, action: string, onBehalfOfId: number | null = null): void {
    const before = { status: c.status, version: c.version };
    c.status = to;
    c.version += 1;
    c.updatedAt = at;
    this.log({ entityType: 'CLAIM', entityId: c.id, action, actorId, onBehalfOfId, before, after: { status: to, version: c.version }, createdAt: at, claimId: c.id });
  }

  createClaim(owner: MUser, title: string, at: number): MClaim {
    const id = this.nextId('claim');
    const c: MClaim = {
      id,
      claimNo: `CLM-${new Date(at).getUTCFullYear()}-${String(id).padStart(4, '0')}`,
      title,
      status: 'DRAFT',
      employeeId: owner.id,
      version: 1,
      sampleAudit: false,
      policyOutcome: null,
      flags: [],
      submittedAt: null,
      approvedAt: null,
      createdAt: at,
      updatedAt: at,
      lastAction: 'Draft created',
    };
    this.claims.push(c);
    this.log({ entityType: 'CLAIM', entityId: id, action: 'CLAIM_CREATED', actorId: owner.id, onBehalfOfId: null, before: null, after: { status: 'DRAFT', title }, createdAt: at, claimId: id });
    return c;
  }

  addLine(c: MClaim, input: Omit<MLine, 'id' | 'claimId' | 'lineOutcome' | 'receiptId'>, at: number): MLine {
    const l: MLine = { ...input, id: this.nextId('line'), claimId: c.id, lineOutcome: null, receiptId: null };
    this.lines.push(l);
    c.updatedAt = at;
    c.version += 1;
    this.log({ entityType: 'CLAIM', entityId: c.id, action: 'LINE_ADDED', actorId: c.employeeId, onBehalfOfId: null, before: null, after: { lineId: l.id, category: l.category, amount: l.amount }, createdAt: at, claimId: c.id });
    return l;
  }

  attachReceipt(line: MLine, blob: Blob, name: string, sha256: string, at: number): MReceipt {
    const r: MReceipt = { id: this.nextId('receipt', 9001), lineId: line.id, originalName: name, contentType: blob.type || 'application/octet-stream', sizeBytes: blob.size, sha256, uploadedAt: at, blob };
    this.receipts = this.receipts.filter((x) => x.lineId !== line.id);
    this.receipts.push(r);
    line.receiptId = r.id;
    const c = this.claim(line.claimId);
    if (c) {
      c.updatedAt = at;
      c.version += 1;
      this.log({ entityType: 'CLAIM', entityId: c.id, action: 'RECEIPT_UPLOADED', actorId: c.employeeId, onBehalfOfId: null, before: null, after: { lineId: line.id, sha256 }, createdAt: at, claimId: c.id });
    }
    return r;
  }

  submit(c: MClaim, at: number): void {
    const owner = this.user(c.employeeId);
    if (!owner) throw new MockError(404, 'Claim not found');
    if (c.status !== 'DRAFT' && c.status !== 'SENT_BACK') throw new MockError(422, `A ${c.status} claim cannot be submitted`);
    if (this.linesOf(c.id).length === 0) throw new MockError(422, 'Add at least one line before submitting', [{ field: 'lines', message: 'At least one line is required' }]);

    const resubmit = c.status === 'SENT_BACK';
    let cycle = 1;
    if (resubmit) {
      for (const s of this.stepsOf(c.id)) if (s.status === 'WAITING' || s.status === 'PENDING') s.status = 'CANCELLED';
      cycle = this.stepsOf(c.id).reduce((m, s) => Math.max(m, s.cycleNo), 0) + 1;
    }
    this.setStatus(c, 'SUBMITTED', owner.id, at, resubmit ? 'CLAIM_RESUBMITTED' : 'CLAIM_SUBMITTED');
    c.submittedAt = at;

    // persist evaluation
    const ev = this.evaluate(c, at);
    const evalNo = this.results.filter((r) => r.claimId === c.id).reduce((m, r) => Math.max(m, r.evaluationNo ?? 0), 0) + 1;
    for (const l of ev.lines) {
      const line = this.lines.find((x) => x.id === l.lineId);
      if (line) line.lineOutcome = l.outcome;
      for (const r of l.results) this.results.push({ ...r, id: this.nextId('result'), claimId: c.id, evaluationNo: evalNo, evaluatedAt: new Date(at).toISOString() });
    }
    c.policyOutcome = ev.claimOutcome;
    this.log({ entityType: 'CLAIM', entityId: c.id, action: 'POLICY_EVALUATED', actorId: null, onBehalfOfId: null, before: null, after: { outcome: ev.claimOutcome, evaluationNo: evalNo }, createdAt: at, claimId: c.id });

    const total = toPaise(this.total(c.id));
    // R1: claim splitting — combine with the employee's other small, live claims from the last 7 days
    // whose expense dates overlap this claim's (± 7 days). Only the auditor step is added.
    const windowStart = at - APP_CONFIG.splitWindowDays * DAY;
    const auditorMin = toPaise(THRESHOLDS[1]?.minExclusive ?? '0');
    const myDates = this.linesOf(c.id).map((l) => Date.parse(l.expenseDate));
    const near = (d: string) => myDates.some((m) => Math.abs(m - Date.parse(d)) <= APP_CONFIG.splitWindowDays * DAY);
    const recent = this.claims.filter(
      (o) =>
        o.id !== c.id &&
        o.employeeId === c.employeeId &&
        o.submittedAt !== null &&
        o.submittedAt >= windowStart &&
        !DEAD.includes(o.status) &&
        toPaise(this.total(o.id)) <= auditorMin &&
        this.linesOf(o.id).some((l) => near(l.expenseDate)),
    );
    const combined = total + recent.reduce((s, o) => s + toPaise(this.total(o.id)), 0);
    const split = recent.length > 0 && total <= auditorMin && combined > auditorMin;
    c.flags = split ? ['SPLIT_SUSPECT'] : [];

    if (ev.claimOutcome === 'AUTO_REJECT') {
      this.setStatus(c, 'POLICY_REJECTED', null, at, 'CLAIM_POLICY_REJECTED');
      c.lastAction = 'Rejected by policy';
      return;
    }
    if (ev.claimOutcome === 'AUTO_APPROVE' && total <= toPaise(APP_CONFIG.autoApproveMaxTotal) && !split) {
      if (this.sampler() < APP_CONFIG.sampleAuditRate) {
        c.sampleAudit = true;
        this.steps.push({ id: this.nextId('step'), claimId: c.id, seq: 2, level: 'AUDITOR', assigneeId: null, status: 'PENDING', actedById: null, onBehalfOfId: null, actedAt: null, activatedAt: at, note: null, cycleNo: cycle });
        this.setStatus(c, 'PENDING_AUDITOR', null, at, 'CLAIM_SAMPLED_FOR_AUDIT');
        c.lastAction = 'Picked for 10% sample audit';
      } else {
        this.setStatus(c, 'APPROVED', null, at, 'CLAIM_AUTO_APPROVED');
        c.approvedAt = at;
        c.lastAction = 'Auto-approved by policy';
      }
      return;
    }

    // Chain snapshot from the threshold table (BR-09)
    const basis = total;
    const fh = this.users.find((u) => u.roles.includes('FINANCE_HEAD'));
    const alternate = this.users.find((u) => u.roles.includes('AUDITOR'));
    const levels = THRESHOLDS.filter((t) => basis > toPaise(t.minExclusive) || (split && t.level === 'AUDITOR'));
    let first = true;
    for (const t of levels) {
      let assignee: number | null = null;
      if (t.level === 'MANAGER') assignee = owner.managerId ?? (fh && fh.id !== owner.id ? fh.id : (alternate?.id ?? null));
      if (t.level === 'FINANCE_HEAD') assignee = fh && fh.id !== owner.id ? fh.id : (alternate?.id ?? null);
      this.steps.push({ id: this.nextId('step'), claimId: c.id, seq: t.seq, level: t.level, assigneeId: assignee, status: first ? 'PENDING' : 'WAITING', actedById: null, onBehalfOfId: null, actedAt: null, activatedAt: first ? at : null, note: null, cycleNo: cycle });
      first = false;
    }
    const firstLevel = levels[0]?.level ?? 'MANAGER';
    this.log({ entityType: 'CLAIM', entityId: c.id, action: 'APPROVAL_CHAIN_CREATED', actorId: null, onBehalfOfId: null, before: null, after: { levels: levels.map((l) => l.level), cycle }, createdAt: at, claimId: c.id });
    this.setStatus(c, `PENDING_${firstLevel}` as ClaimStatus, null, at, 'CLAIM_ROUTED');
    c.lastAction = `Waiting for ${firstLevel === 'FINANCE_HEAD' ? 'finance head' : firstLevel.toLowerCase()}`;
  }

  act(c: MClaim, actor: MUser, action: 'APPROVE' | 'REJECT' | 'SEND_BACK', version: number | undefined, text: string | null, at: number): void {
    if (!this.canView(actor, c, at)) throw new MockError(404, 'Claim not found');
    const step = this.currentStep(c.id);
    if (!step || !c.status.startsWith('PENDING_')) throw new MockError(422, 'This claim is not waiting for approval');
    if (c.employeeId === actor.id) throw new MockError(403, 'You cannot act on your own claim');
    const who = this.stepActor(step, actor, at);
    if (!who.ok) throw new MockError(403, 'You are not the current approver for this claim');
    if (version !== undefined && version !== c.version) throw new MockError(409, 'This claim was updated by someone else');
    if (action !== 'APPROVE' && !text?.trim()) {
      const field = action === 'REJECT' ? 'reason' : 'comment';
      throw new MockError(422, `A ${field} is required`, [{ field, message: `A ${field} is required` }]);
    }

    const before = { status: step.status };
    step.actedById = actor.id;
    step.onBehalfOfId = who.onBehalfOf;
    step.actedAt = at;
    step.note = text?.trim() || null;
    const actorLabel = `${actor.name}${who.onBehalfOf ? ` for ${this.name(who.onBehalfOf)}` : ''}`;

    if (action === 'APPROVE') {
      step.status = 'APPROVED';
      this.log({ entityType: 'APPROVAL_STEP', entityId: step.id, action: 'STEP_APPROVED', actorId: actor.id, onBehalfOfId: who.onBehalfOf, before, after: { status: 'APPROVED', level: step.level }, createdAt: at, claimId: c.id });
      const next = this.stepsOf(c.id).find((s) => s.cycleNo === step.cycleNo && s.status === 'WAITING');
      if (next) {
        next.status = 'PENDING';
        next.activatedAt = at;
        this.setStatus(c, `PENDING_${next.level}` as ClaimStatus, actor.id, at, 'CLAIM_ADVANCED', who.onBehalfOf);
        c.lastAction = `Approved by ${actorLabel}`;
      } else {
        this.setStatus(c, 'APPROVED', actor.id, at, 'CLAIM_APPROVED', who.onBehalfOf);
        c.approvedAt = at;
        c.lastAction = `Approved by ${actorLabel}`;
      }
      return;
    }
    for (const s of this.stepsOf(c.id)) if (s.cycleNo === step.cycleNo && s.status === 'WAITING') s.status = 'CANCELLED';
    if (action === 'REJECT') {
      step.status = 'REJECTED';
      this.log({ entityType: 'APPROVAL_STEP', entityId: step.id, action: 'STEP_REJECTED', actorId: actor.id, onBehalfOfId: who.onBehalfOf, before, after: { status: 'REJECTED', reason: step.note }, createdAt: at, claimId: c.id });
      this.setStatus(c, 'REJECTED', actor.id, at, 'CLAIM_REJECTED', who.onBehalfOf);
      c.lastAction = `Rejected by ${actorLabel}`;
    } else {
      step.status = 'SENT_BACK';
      this.log({ entityType: 'APPROVAL_STEP', entityId: step.id, action: 'STEP_SENT_BACK', actorId: actor.id, onBehalfOfId: who.onBehalfOf, before, after: { status: 'SENT_BACK', comment: step.note }, createdAt: at, claimId: c.id });
      this.comments.push({ id: this.nextId('comment'), claimId: c.id, authorId: actor.id, body: step.note ?? '', createdAt: at });
      this.setStatus(c, 'SENT_BACK', actor.id, at, 'CLAIM_SENT_BACK', who.onBehalfOf);
      c.lastAction = `Sent back by ${actorLabel}`;
    }
  }

  // ---------- payouts ----------
  activeBatchOf(claimId: number): MBatch | undefined {
    return this.batches.find((b) => b.status !== 'VOID' && b.items.some((i) => i.claimId === claimId));
  }
  createBatch(actor: MUser, claimIds: number[], at: number): MBatch {
    if (claimIds.length === 0) throw new MockError(422, 'Select at least one claim', [{ field: 'claimIds', message: 'Select at least one claim' }]);
    const claims = claimIds.map((id) => this.claim(id));
    for (const c of claims) {
      if (!c) throw new MockError(404, 'Claim not found');
      if (c.status !== 'APPROVED' || this.activeBatchOf(c.id)) throw new MockError(409, `${c.claimNo} is already in a batch or not approved`);
    }
    const id = this.nextId('batch', 1);
    const b: MBatch = {
      id,
      batchNo: `B${id}`,
      status: 'DRAFT',
      createdAt: at,
      createdById: actor.id,
      exportedAt: null,
      paidAt: null,
      fileName: null,
      fileSha256: null,
      voidReason: null,
      version: 1,
      items: (claims as MClaim[]).map((c) => ({ claimId: c.id, employeeId: c.employeeId, amount: this.total(c.id) })),
    };
    this.batches.push(b);
    for (const c of claims as MClaim[]) {
      this.setStatus(c, 'IN_PAYOUT', actor.id, at, 'PAYOUT_ITEM_ADDED');
      c.lastAction = `Added to payout batch ${b.batchNo}`;
    }
    this.log({ entityType: 'PAYOUT_BATCH', entityId: id, action: 'PAYOUT_BATCH_CREATED', actorId: actor.id, onBehalfOfId: null, before: null, after: { claims: b.items.length }, createdAt: at, claimId: null });
    return b;
  }
  batchCsv(b: MBatch, at: number): { name: string; text: string } {
    const ymd = istDate(at).replace(/-/g, '');
    const byEmp = new Map<number, { amount: number; claims: string[] }>();
    for (const it of b.items) {
      const e = byEmp.get(it.employeeId) ?? { amount: 0, claims: [] };
      e.amount += toPaise(it.amount);
      e.claims.push(this.claim(it.claimId)?.claimNo ?? String(it.claimId));
      byEmp.set(it.employeeId, e);
    }
    const total = fromPaise([...byEmp.values()].reduce((s, e) => s + e.amount, 0));
    const esc = (v: string) => {
      const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const rows = [
      'H,BATCH_ID,DATE,COUNT,TOTAL',
      `H,${b.id},${istDate(at)},${byEmp.size},${total}`,
      'D,EMP_ID,NAME,BANK_ACCOUNT,IFSC,AMOUNT,CLAIM_IDS,NARRATION',
      ...[...byEmp.entries()]
        .sort((a, z) => (this.user(a[0])?.empCode ?? '').localeCompare(this.user(z[0])?.empCode ?? ''))
        .map(([empId, e]) => {
          const u = this.user(empId);
          return ['D', u?.empCode ?? String(empId), u?.name ?? '', u?.bankAccountMasked ?? '', u?.ifsc ?? '', fromPaise(e.amount), e.claims.join('|'), `EXPF ${b.batchNo} reimbursement`].map(esc).join(',');
        }),
      `T,CONTROL_TOTAL,${total},COUNT,${byEmp.size}`,
    ];
    return { name: `EXPF_${ymd}_${b.id}.csv`, text: `${rows.join('\n')}\n` };
  }
  exportBatch(actor: MUser, b: MBatch, at: number): { name: string; text: string } {
    if (b.status === 'VOID') throw new MockError(422, 'A void batch cannot be exported');
    const csv = this.batchCsv(b, b.exportedAt ?? at);
    if (b.status === 'DRAFT') {
      b.status = 'EXPORTED';
      b.exportedAt = at;
      b.fileName = csv.name;
      b.fileSha256 = digestHex(csv.text);
      b.version += 1;
      this.log({ entityType: 'PAYOUT_BATCH', entityId: b.id, action: 'PAYOUT_BATCH_EXPORTED', actorId: actor.id, onBehalfOfId: null, before: { status: 'DRAFT' }, after: { status: 'EXPORTED', file: csv.name }, createdAt: at, claimId: null });
    }
    return csv;
  }
  markPaid(actor: MUser, b: MBatch, version: number | undefined, at: number): void {
    if (b.status !== 'EXPORTED') throw new MockError(422, 'Export the CSV before marking the batch paid');
    if (version !== undefined && version !== b.version) throw new MockError(409, 'This batch was updated by someone else');
    b.status = 'PAID';
    b.paidAt = at;
    b.version += 1;
    for (const it of b.items) {
      const c = this.claim(it.claimId);
      if (c) {
        this.setStatus(c, 'PAID', actor.id, at, 'PAYOUT_BATCH_PAID');
        c.lastAction = `Paid in ${b.batchNo}`;
      }
    }
  }
  voidBatch(actor: MUser, b: MBatch, reason: string, at: number): void {
    if (b.status === 'PAID') throw new MockError(422, 'A paid batch cannot be voided');
    if (b.status === 'VOID') throw new MockError(422, 'This batch is already void');
    if (!reason.trim()) throw new MockError(422, 'A reason is required', [{ field: 'reason', message: 'A reason is required' }]);
    b.status = 'VOID';
    b.voidReason = reason.trim();
    b.version += 1;
    for (const it of b.items) {
      const c = this.claim(it.claimId);
      if (c) {
        this.setStatus(c, 'APPROVED', actor.id, at, 'PAYOUT_BATCH_VOIDED');
        c.lastAction = `Returned from voided batch ${b.batchNo}`;
      }
    }
  }

  inFlightOf(userId: number): number {
    return this.claims.filter((c) => c.employeeId === userId && IN_FLIGHT.includes(c.status)).length;
  }
}

export const cityTier = cityTierFor;
