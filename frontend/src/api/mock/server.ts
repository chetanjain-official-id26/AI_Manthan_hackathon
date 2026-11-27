/**
 * Demo mock backend: serves the LLD §6 REST contract from the in-memory MockDb.
 * Loaded lazily by api/client.ts only when demo mock mode is on.
 */
import type {
  AuditorQueueItem,
  BulkApproveResult,
  ClaimDetail,
  ClaimLine,
  ClaimStatus,
  ClaimSummary,
  Delegation,
  Flag,
  InboxItem,
  Me,
  PayoutBatch,
  PolicyRule,
  UserSummary,
} from '../types';
import { cityTierFor } from '@/utils/cities';
import { fromPaise, isValidAmount, toPaise } from '@/utils/money';
import { DAY, MockDb, MockError, digestHex, istDate, iso, type MBatch, type MClaim, type MLine, type MUser } from './db';
import { seed } from './seed';

let db: MockDb | null = null;
const getDb = () => (db ??= seed());
/** Test hook: start again from the seed. */
export function resetMockDb(): void {
  db = null;
}

// ---------------------------------------------------------------- response helpers
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const problem = (status: number, detail: string, errors?: { field: string; message: string }[]) =>
  new Response(JSON.stringify({ type: 'about:blank', title: titleFor(status), status, detail, ...(errors ? { errors } : {}) }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
const titleFor = (s: number) => ({ 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 413: 'Payload Too Large', 415: 'Unsupported Media Type', 422: 'Unprocessable Entity' })[s] ?? 'Error';
const pageOf = <T,>(all: T[], page: number, size: number) => ({
  content: all.slice(page * size, page * size + size),
  page: { number: page, size, totalElements: all.length, totalPages: Math.max(1, Math.ceil(all.length / size)) },
});

const latency = () => new Promise((r) => setTimeout(r, 120 + Math.random() * 180));

// ---------------------------------------------------------------- DTO builders
function userDto(_d: MockDb, u: MUser): UserSummary {
  return { id: u.id, empCode: u.empCode, name: u.name, email: u.email, department: u.department, roles: u.roles, managerId: u.managerId };
}
function delegationDto(d: MockDb, x: MockDb['delegations'][number]): Delegation {
  return { id: x.id, delegatorId: x.delegatorId, delegatorName: d.name(x.delegatorId) ?? undefined, delegateId: x.delegateId, delegateName: d.name(x.delegateId) ?? undefined, fromDate: x.fromDate, toDate: x.toDate, reason: x.reason, revoked: x.revoked, createdAt: iso(x.createdAt) ?? undefined };
}
function claimFlags(d: MockDb, c: MClaim): Flag[] {
  const evals = d.results.filter((r) => r.claimId === c.id);
  const maxEval = evals.reduce((m, r) => Math.max(m, r.evaluationNo ?? 0), 0);
  const set = new Set<Flag>(c.flags);
  for (const r of evals) if ((r.evaluationNo ?? 0) === maxEval && r.flag) set.add(r.flag);
  if (c.sampleAudit) set.add('SAMPLE');
  return [...set];
}
function summaryDto(d: MockDb, c: MClaim): ClaimSummary {
  const owner = d.user(c.employeeId);
  return {
    id: c.id,
    claimNo: c.claimNo,
    title: c.title,
    status: c.status,
    totalAmount: d.total(c.id),
    lineCount: d.linesOf(c.id).length,
    submittedAt: iso(c.submittedAt),
    updatedAt: iso(c.updatedAt),
    createdAt: iso(c.createdAt),
    lastAction: c.lastAction,
    employeeId: c.employeeId,
    employeeName: owner?.name,
    department: owner?.department,
    version: c.version,
    flags: claimFlags(d, c),
  };
}
function lineDto(d: MockDb, l: MLine): ClaimLine {
  const r = l.receiptId ? d.receipts.find((x) => x.id === l.receiptId) : undefined;
  return {
    id: l.id,
    category: l.category,
    amount: l.amount,
    expenseDate: l.expenseDate,
    vendor: l.vendor,
    city: l.city,
    cityTier: l.cityTier,
    nights: l.nights,
    description: l.description,
    lineOutcome: l.lineOutcome,
    receipt: r ? { id: r.id, originalName: r.originalName, contentType: r.contentType, sizeBytes: r.sizeBytes, sha256: r.sha256, uploadedAt: iso(r.uploadedAt) ?? undefined } : null,
  };
}
function detailDto(d: MockDb, c: MClaim): ClaimDetail {
  return {
    ...summaryDto(d, c),
    employeeId: c.employeeId,
    sampleAudit: c.sampleAudit,
    policyOutcome: c.policyOutcome,
    approvedAt: iso(c.approvedAt),
    lines: d.linesOf(c.id).map((l) => lineDto(d, l)),
    policyResults: d.results.filter((r) => r.claimId === c.id).map(({ claimId: _c, ...r }) => r),
    approvalSteps: d.stepsOf(c.id).map((s) => ({
      id: s.id,
      seq: s.seq,
      level: s.level,
      assigneeId: s.assigneeId,
      assigneeName: d.name(s.assigneeId),
      status: s.status,
      actedById: s.actedById,
      actedByName: d.name(s.actedById),
      onBehalfOfId: s.onBehalfOfId,
      onBehalfOfName: d.name(s.onBehalfOfId),
      actedAt: iso(s.actedAt),
      activatedAt: iso(s.activatedAt),
      note: s.note,
      cycleNo: s.cycleNo,
    })),
    comments: d.comments.filter((x) => x.claimId === c.id).map((x) => ({ id: x.id, authorId: x.authorId, authorName: d.name(x.authorId) ?? undefined, body: x.body, createdAt: iso(x.createdAt) ?? '' })),
  };
}
function batchDto(d: MockDb, b: MBatch): PayoutBatch {
  return {
    id: b.id,
    batchNo: b.batchNo,
    status: b.status,
    claimCount: b.items.length,
    employeeCount: new Set(b.items.map((i) => i.employeeId)).size,
    totalAmount: fromPaise(b.items.reduce((s, i) => s + toPaise(i.amount), 0)),
    fileName: b.fileName,
    fileSha256: b.fileSha256,
    createdAt: iso(b.createdAt) ?? undefined,
    createdByName: d.name(b.createdById) ?? undefined,
    exportedAt: iso(b.exportedAt),
    paidAt: iso(b.paidAt),
    voidReason: b.voidReason,
    version: b.version,
    items: b.items.map((i, k) => {
      const u = d.user(i.employeeId);
      return { id: k + 1, claimId: i.claimId, claimNo: d.claim(i.claimId)?.claimNo, employeeId: i.employeeId, employeeName: u?.name, empCode: u?.empCode, amount: i.amount };
    }),
  };
}
function ruleDto(r: MockDb['rules'][number]): PolicyRule {
  return { id: r.id, ruleCode: r.ruleCode, category: r.category, cityTier: r.cityTier, limitAmount: r.limitAmount, unit: r.unit, action: r.action, flag: r.flag, params: r.params, active: r.active, version: r.version, effectiveFrom: r.effectiveFrom, createdByName: r.createdByName, createdAt: r.createdAt, reason: r.reason };
}

// ---------------------------------------------------------------- request context
interface Ctx {
  d: MockDb;
  method: string;
  path: string;
  q: URLSearchParams;
  body: Record<string, unknown>;
  form: FormData | null;
  me: MUser | null;
  now: number;
}
const need = (ctx: Ctx): MUser => {
  if (!ctx.me) throw new MockError(401, 'Sign in again');
  return ctx.me;
};
const requireRole = (u: MUser, ...roles: MUser['roles']) => {
  if (!roles.some((r) => u.roles.includes(r))) throw new MockError(403, 'You do not have access to this area');
};
const visibleClaim = (ctx: Ctx, id: number): MClaim => {
  const u = need(ctx);
  const c = ctx.d.claim(id);
  if (!c || !ctx.d.canView(u, c, ctx.now)) throw new MockError(404, 'Claim not found');
  return c;
};
const ownEditable = (ctx: Ctx, id: number): MClaim => {
  const c = visibleClaim(ctx, id);
  if (c.employeeId !== ctx.me?.id) throw new MockError(404, 'Claim not found');
  if (c.status !== 'DRAFT' && c.status !== 'SENT_BACK') throw new MockError(422, 'Only draft or sent-back claims can be edited');
  return c;
};
const str = (v: unknown) => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));

function validateLine(ctx: Ctx): Omit<MLine, 'id' | 'claimId' | 'lineOutcome' | 'receiptId'> {
  const b = ctx.body;
  const errors: { field: string; message: string }[] = [];
  const category = str(b.category);
  if (!['MEAL', 'HOTEL', 'CAB', 'OTHER'].includes(category)) errors.push({ field: 'category', message: 'Choose a category' });
  const amount = str(b.amount);
  if (!isValidAmount(amount)) errors.push({ field: 'amount', message: 'Amount must be greater than 0 with at most 2 decimals' });
  const expenseDate = str(b.expenseDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) errors.push({ field: 'expenseDate', message: 'Choose a date' });
  else if (expenseDate > istDate(ctx.now)) errors.push({ field: 'expenseDate', message: 'The expense date cannot be in the future' });
  const vendor = str(b.vendor).trim();
  if (!vendor) errors.push({ field: 'vendor', message: 'Vendor is required' });
  const nights = b.nights === null || b.nights === undefined || b.nights === '' ? null : num(b.nights);
  if (category === 'HOTEL' && (!nights || nights < 1)) errors.push({ field: 'nights', message: 'Hotel lines need at least 1 night' });
  if (errors.length) throw new MockError(422, 'Please fix the highlighted fields', errors);
  const city = str(b.city).trim();
  const tier = str(b.cityTier);
  return {
    category: category as MLine['category'],
    amount: fromPaise(toPaise(amount)),
    expenseDate,
    vendor,
    city,
    cityTier: tier === 'TIER_1' || tier === 'OTHER' ? tier : cityTierFor(city),
    nights: category === 'HOTEL' ? nights : null,
    description: str(b.description).trim(),
  };
}

function rejectUnknown(body: Record<string, unknown>, allowed: string[]): void {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length) throw new MockError(400, `Unknown field(s): ${extra.join(', ')}`);
}

// ---------------------------------------------------------------- routes
type Handler = (ctx: Ctx, params: string[]) => Response | Promise<Response>;
const routes: [string, RegExp, Handler][] = [];
const on = (method: string, pattern: string, h: Handler) =>
  routes.push([method, new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}$`), h]);

// ---- auth
on('GET', '/auth/demo-users', ({ d }) => json(d.users.map((u) => userDto(d, u))));
on('POST', '/auth/demo-login', ({ d, body, now }) => {
  const u = d.user(num(body.employeeId));
  if (!u) throw new MockError(404, 'User not found');
  return json({ token: `mock-${u.id}`, expiresAt: new Date(now + 60 * 60_000).toISOString(), user: userDto(d, u) });
});
on('GET', '/me', (ctx) => {
  const u = need(ctx);
  const me: Me = { ...userDto(ctx.d, u), activeDelegations: ctx.d.activeDelegationsInvolving(u.id, ctx.now).map((x) => delegationDto(ctx.d, x)) };
  return json(me);
});

// ---- claims
on('GET', '/claims', (ctx) => {
  const u = need(ctx);
  const mine = ctx.q.get('mine') === 'true';
  const status = ctx.q.get('status') as ClaimStatus | null;
  const page = Number(ctx.q.get('page') ?? 0) || 0;
  const list = ctx.d.claims
    .filter((c) => (mine ? c.employeeId === u.id : c.employeeId !== u.id && ctx.d.canView(u, c, ctx.now)))
    .filter((c) => !status || c.status === status)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => summaryDto(ctx.d, c));
  return json(pageOf(list, page, 20));
});
on('POST', '/claims', (ctx) => {
  const u = need(ctx);
  rejectUnknown(ctx.body, ['title']);
  const title = str(ctx.body.title).trim();
  if (!title) throw new MockError(422, 'Title is required', [{ field: 'title', message: 'Title is required' }]);
  return json(detailDto(ctx.d, ctx.d.createClaim(u, title, ctx.now)), 201);
});
on('GET', '/claims/(\\d+)', (ctx, [id]) => json(detailDto(ctx.d, visibleClaim(ctx, Number(id)))));
on('PATCH', '/claims/(\\d+)', (ctx, [id]) => {
  rejectUnknown(ctx.body, ['title', 'version']);
  const c = ownEditable(ctx, Number(id));
  if (ctx.body.version !== undefined && num(ctx.body.version) !== c.version) throw new MockError(409, 'This claim was updated by someone else');
  const title = str(ctx.body.title).trim();
  if (!title) throw new MockError(422, 'Title is required', [{ field: 'title', message: 'Title is required' }]);
  c.title = title;
  c.version += 1;
  c.updatedAt = ctx.now;
  return json(detailDto(ctx.d, c));
});
on('POST', '/claims/(\\d+)/lines', (ctx, [id]) => {
  const c = ownEditable(ctx, Number(id));
  rejectUnknown(ctx.body, ['category', 'amount', 'expenseDate', 'vendor', 'city', 'cityTier', 'nights', 'description']);
  return json(lineDto(ctx.d, ctx.d.addLine(c, validateLine(ctx), ctx.now)), 201);
});
on('PUT', '/claims/(\\d+)/lines/(\\d+)', (ctx, [id, lineId]) => {
  const c = ownEditable(ctx, Number(id));
  const line = ctx.d.lines.find((l) => l.id === Number(lineId) && l.claimId === c.id);
  if (!line) throw new MockError(404, 'Line not found');
  const before = { amount: line.amount, category: line.category };
  Object.assign(line, validateLine(ctx));
  c.version += 1;
  c.updatedAt = ctx.now;
  ctx.d.log({ entityType: 'CLAIM', entityId: c.id, action: 'LINE_UPDATED', actorId: c.employeeId, onBehalfOfId: null, before, after: { amount: line.amount, category: line.category }, createdAt: ctx.now, claimId: c.id });
  return json(lineDto(ctx.d, line));
});
on('DELETE', '/claims/(\\d+)/lines/(\\d+)', (ctx, [id, lineId]) => {
  const c = ownEditable(ctx, Number(id));
  const before = ctx.d.lines.length;
  ctx.d.lines = ctx.d.lines.filter((l) => !(l.id === Number(lineId) && l.claimId === c.id));
  if (ctx.d.lines.length === before) throw new MockError(404, 'Line not found');
  c.version += 1;
  c.updatedAt = ctx.now;
  ctx.d.log({ entityType: 'CLAIM', entityId: c.id, action: 'LINE_REMOVED', actorId: c.employeeId, onBehalfOfId: null, before: { lineId: Number(lineId) }, after: null, createdAt: ctx.now, claimId: c.id });
  return new Response(null, { status: 204 });
});
on('POST', '/claims/(\\d+)/lines/(\\d+)/receipt', async (ctx, [id, lineId]) => {
  const c = ownEditable(ctx, Number(id));
  const line = ctx.d.lines.find((l) => l.id === Number(lineId) && l.claimId === c.id);
  if (!line) throw new MockError(404, 'Line not found');
  const file = ctx.form?.get('file');
  if (!(file instanceof Blob)) throw new MockError(422, 'Attach a file', [{ field: 'file', message: 'Attach a file' }]);
  if (file.size > 5 * 1024 * 1024) throw new MockError(413, 'The file is larger than 5 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPdf && !isPng && !isJpg) throw new MockError(415, 'Only PDF, JPG or PNG files are accepted');
  const type = isPdf ? 'application/pdf' : isPng ? 'image/png' : 'image/jpeg';
  const name = (file instanceof File ? file.name : 'receipt').replace(/[^\w.-]+/g, '_').slice(-80);
  const r = ctx.d.attachReceipt(line, new Blob([bytes], { type }), name, digestHex(bytes), ctx.now);
  return json({ receiptId: r.id, sha256: r.sha256 }, 201);
});
on('GET', '/receipts/(\\d+)', (ctx, [rid]) => {
  const r = ctx.d.receipts.find((x) => x.id === Number(rid));
  const line = r ? ctx.d.lines.find((l) => l.id === r.lineId) : undefined;
  if (!r || !line) throw new MockError(404, 'Receipt not found');
  visibleClaim(ctx, line.claimId);
  return new Response(r.blob, { headers: { 'Content-Type': r.contentType, 'Content-Disposition': `attachment; filename="${r.originalName}"`, 'X-Content-Type-Options': 'nosniff' } });
});
on('POST', '/claims/(\\d+)/policy-preview', (ctx, [id]) => {
  const c = visibleClaim(ctx, Number(id));
  if (c.employeeId !== ctx.me?.id) throw new MockError(404, 'Claim not found');
  return json(ctx.d.evaluate(c, ctx.now));
});
on('POST', '/claims/(\\d+)/submit', (ctx, [id]) => {
  const c = visibleClaim(ctx, Number(id));
  if (c.employeeId !== ctx.me?.id) throw new MockError(404, 'Claim not found');
  if (ctx.body.version !== undefined && num(ctx.body.version) !== c.version) throw new MockError(409, 'This claim was updated by someone else');
  ctx.d.submit(c, ctx.now);
  return json(detailDto(ctx.d, c));
});
for (const [path, action, field] of [
  ['approve', 'APPROVE', 'note'],
  ['reject', 'REJECT', 'reason'],
  ['send-back', 'SEND_BACK', 'comment'],
] as const) {
  on('POST', `/claims/(\\d+)/${path}`, (ctx, [id]) => {
    const u = need(ctx);
    const c = ctx.d.claim(Number(id));
    if (!c) throw new MockError(404, 'Claim not found');
    ctx.d.act(c, u, action, ctx.body.version === undefined ? undefined : num(ctx.body.version), str(ctx.body[field]) || null, ctx.now);
    return json(detailDto(ctx.d, c));
  });
}
on('POST', '/claims/(\\d+)/comments', (ctx, [id]) => {
  const u = need(ctx);
  const c = visibleClaim(ctx, Number(id));
  const body = str(ctx.body.body).trim();
  if (!body) throw new MockError(422, 'Write a comment', [{ field: 'body', message: 'Write a comment' }]);
  const cm = { id: ctx.d.nextId('comment'), claimId: c.id, authorId: u.id, body, createdAt: ctx.now };
  ctx.d.comments.push(cm);
  ctx.d.log({ entityType: 'CLAIM', entityId: c.id, action: 'COMMENT_ADDED', actorId: u.id, onBehalfOfId: null, before: null, after: { body }, createdAt: ctx.now, claimId: c.id });
  return json({ ...cm, createdAt: iso(cm.createdAt), authorName: u.name }, 201);
});

// ---- approvals
on('GET', '/approvals/inbox', (ctx) => {
  const u = need(ctx);
  const items: InboxItem[] = [];
  for (const s of ctx.d.steps) {
    if (s.status !== 'PENDING') continue;
    const c = ctx.d.claim(s.claimId);
    if (!c || c.employeeId === u.id || !c.status.startsWith('PENDING_')) continue;
    const who = ctx.d.stepActor(s, u, ctx.now);
    if (!who.ok) continue;
    const owner = ctx.d.user(c.employeeId);
    items.push({
      stepId: s.id,
      claimId: c.id,
      claimNo: c.claimNo,
      employeeId: c.employeeId,
      employeeName: owner?.name ?? '',
      department: owner?.department,
      totalAmount: ctx.d.total(c.id),
      flags: claimFlags(ctx.d, c),
      level: s.level,
      activatedAt: iso(s.activatedAt),
      onBehalfOfId: who.onBehalfOf,
      onBehalfOfName: ctx.d.name(who.onBehalfOf),
      sampleAudit: c.sampleAudit,
      version: c.version,
    });
  }
  items.sort((a, b) => (a.activatedAt ?? '').localeCompare(b.activatedAt ?? ''));
  return json(items);
});
on('GET', '/delegations', (ctx) => {
  const u = need(ctx);
  return json(ctx.d.delegations.filter((x) => x.delegatorId === u.id || x.delegateId === u.id).map((x) => delegationDto(ctx.d, x)));
});
on('POST', '/delegations', (ctx) => {
  const u = need(ctx);
  requireRole(u, 'MANAGER', 'AUDITOR', 'FINANCE_HEAD');
  rejectUnknown(ctx.body, ['delegateId', 'fromDate', 'toDate', 'reason']);
  const delegateId = num(ctx.body.delegateId);
  const fromDate = str(ctx.body.fromDate);
  const toDate = str(ctx.body.toDate);
  const reason = str(ctx.body.reason).trim();
  if (delegateId === u.id) throw new MockError(422, 'You cannot delegate to yourself', [{ field: 'delegateId', message: 'You cannot delegate to yourself' }]);
  if (!ctx.d.user(delegateId)) throw new MockError(422, 'Choose a colleague', [{ field: 'delegateId', message: 'Choose a colleague' }]);
  if (!fromDate || !toDate || toDate < fromDate) throw new MockError(422, 'End date must be on or after the start date', [{ field: 'toDate', message: 'End date must be on or after the start date' }]);
  if (!reason) throw new MockError(422, 'A reason is required', [{ field: 'reason', message: 'A reason is required' }]);
  const live = ctx.d.delegations.filter((x) => !x.revoked && x.toDate >= istDate(ctx.now));
  if (live.some((x) => x.delegatorId === u.id && x.fromDate <= toDate && fromDate <= x.toDate)) throw new MockError(422, 'Dates overlap an existing delegation');
  // cycle: does the delegate (directly or transitively) delegate to me?
  const seen = new Set<number>();
  const stack = [delegateId];
  while (stack.length) {
    const cur = stack.pop() as number;
    if (cur === u.id) throw new MockError(422, 'Would create a delegation loop (cycle)');
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const x of live) if (x.delegatorId === cur) stack.push(x.delegateId);
  }
  const x = { id: ctx.d.nextId('delegation'), delegatorId: u.id, delegateId, fromDate, toDate, reason, revoked: false, createdAt: ctx.now };
  ctx.d.delegations.push(x);
  ctx.d.log({ entityType: 'DELEGATION', entityId: x.id, action: 'DELEGATION_CREATED', actorId: u.id, onBehalfOfId: null, before: null, after: { delegateId, fromDate, toDate }, createdAt: ctx.now, claimId: null });
  return json(delegationDto(ctx.d, x), 201);
});
on('DELETE', '/delegations/(\\d+)', (ctx, [id]) => {
  const u = need(ctx);
  const x = ctx.d.delegations.find((y) => y.id === Number(id) && y.delegatorId === u.id);
  if (!x) throw new MockError(404, 'Delegation not found');
  x.revoked = true;
  ctx.d.log({ entityType: 'DELEGATION', entityId: x.id, action: 'DELEGATION_REVOKED', actorId: u.id, onBehalfOfId: null, before: { revoked: false }, after: { revoked: true }, createdAt: ctx.now, claimId: null });
  return new Response(null, { status: 204 });
});

// ---- auditor
const SORTS = ['age', '-age', 'amount', '-amount'];
on('GET', '/auditor/queue', (ctx) => {
  const u = need(ctx);
  requireRole(u, 'AUDITOR', 'FINANCE_HEAD');
  const q = ctx.q;
  const sort = q.get('sort') ?? '-age';
  if (!SORTS.includes(sort)) throw new MockError(400, `Invalid sort: ${sort}`);
  const min = q.get('min');
  const max = q.get('max');
  const ageDays = q.get('ageDays');
  let rows: AuditorQueueItem[] = ctx.d.claims
    .filter((c) => c.status === 'PENDING_AUDITOR')
    .map((c) => {
      const owner = ctx.d.user(c.employeeId);
      const step = ctx.d.currentStep(c.id);
      const mgrStep = ctx.d.stepsOf(c.id).find((s) => s.level === 'MANAGER' && s.status === 'APPROVED' && s.cycleNo === step?.cycleNo);
      return {
        claimId: c.id,
        claimNo: c.claimNo,
        employeeId: c.employeeId,
        employeeName: owner?.name ?? '',
        department: owner?.department,
        lineCount: ctx.d.linesOf(c.id).length,
        totalAmount: ctx.d.total(c.id),
        flags: claimFlags(ctx.d, c),
        sampleAudit: c.sampleAudit,
        managerApprovedBy: mgrStep ? ctx.d.name(mgrStep.actedById) : null,
        activatedAt: iso(step?.activatedAt),
        status: c.status,
        version: c.version,
      };
    });
  if (q.get('dept')) rows = rows.filter((r) => r.department === q.get('dept'));
  if (q.get('category')) rows = rows.filter((r) => ctx.d.linesOf(r.claimId).some((l) => l.category === q.get('category')));
  if (min) rows = rows.filter((r) => toPaise(r.totalAmount) >= toPaise(min));
  if (max) rows = rows.filter((r) => toPaise(r.totalAmount) <= toPaise(max));
  if (q.get('flag')) rows = rows.filter((r) => r.flags?.includes(q.get('flag') as Flag));
  if (q.get('sample') === 'true') rows = rows.filter((r) => r.sampleAudit);
  if (ageDays) rows = rows.filter((r) => ctx.now - Date.parse(r.activatedAt ?? '') > Number(ageDays) * DAY);
  const key = sort.replace('-', '');
  const dir = sort.startsWith('-') ? -1 : 1;
  rows.sort((a, b) =>
    key === 'amount'
      ? dir * (toPaise(a.totalAmount) - toPaise(b.totalAmount))
      : dir * (Date.parse(b.activatedAt ?? '') - Date.parse(a.activatedAt ?? '')),
  );
  return json(pageOf(rows, Number(q.get('page') ?? 0) || 0, 50));
});
on('POST', '/auditor/bulk-approve', (ctx) => {
  const u = need(ctx);
  requireRole(u, 'AUDITOR');
  const items = Array.isArray(ctx.body.items) ? (ctx.body.items as { claimId: number; version: number }[]) : [];
  if (items.length > 100) throw new MockError(400, 'At most 100 claims per bulk approve');
  const out: BulkApproveResult[] = items.map((it) => {
    try {
      const c = ctx.d.claim(num(it.claimId));
      if (!c) throw new MockError(404, 'Claim not found');
      if (c.status !== 'PENDING_AUDITOR') throw new MockError(422, 'Not waiting for audit');
      ctx.d.act(c, u, 'APPROVE', num(it.version), null, ctx.now);
      return { claimId: it.claimId, result: 'APPROVED' };
    } catch (e) {
      const msg = e instanceof MockError ? (e.status === 409 ? 'Stale version — someone changed this claim' : e.message) : 'Failed';
      return { claimId: it.claimId, result: 'FAILED', error: msg };
    }
  });
  return json(out);
});

// ---- payouts
on('GET', '/payouts', (ctx) => {
  requireRole(need(ctx), 'FINANCE_HEAD');
  return json([...ctx.d.batches].sort((a, b) => b.createdAt - a.createdAt).map((b) => batchDto(ctx.d, b)));
});
on('GET', '/payouts/eligible', (ctx) => {
  requireRole(need(ctx), 'FINANCE_HEAD');
  return json(ctx.d.claims.filter((c) => c.status === 'APPROVED' && !ctx.d.activeBatchOf(c.id)).sort((a, b) => (a.approvedAt ?? 0) - (b.approvedAt ?? 0)).map((c) => summaryDto(ctx.d, c)));
});
on('POST', '/payouts', (ctx) => {
  const u = need(ctx);
  requireRole(u, 'FINANCE_HEAD');
  const ids = Array.isArray(ctx.body.claimIds) ? (ctx.body.claimIds as unknown[]).map(num) : [];
  return json(batchDto(ctx.d, ctx.d.createBatch(u, ids, ctx.now)), 201);
});
const batch = (ctx: Ctx, id: string | undefined) => {
  requireRole(need(ctx), 'FINANCE_HEAD');
  const b = ctx.d.batches.find((x) => x.id === Number(id));
  if (!b) throw new MockError(404, 'Batch not found');
  return b;
};
on('GET', '/payouts/(\\d+)', (ctx, [id]) => json(batchDto(ctx.d, batch(ctx, id))));
on('GET', '/payouts/(\\d+)/csv', (ctx, [id]) => {
  const csv = ctx.d.exportBatch(need(ctx), batch(ctx, id), ctx.now);
  return new Response(csv.text, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${csv.name}"` } });
});
on('POST', '/payouts/(\\d+)/mark-paid', (ctx, [id]) => {
  const b = batch(ctx, id);
  ctx.d.markPaid(need(ctx), b, ctx.body.version === undefined ? undefined : num(ctx.body.version), ctx.now);
  return json(batchDto(ctx.d, b));
});
on('POST', '/payouts/(\\d+)/void', (ctx, [id]) => {
  const b = batch(ctx, id);
  ctx.d.voidBatch(need(ctx), b, str(ctx.body.reason), ctx.now);
  return json(batchDto(ctx.d, b));
});

// ---- dashboard
function dashScope(ctx: Ctx): MClaim[] {
  const u = need(ctx);
  requireRole(u, 'MANAGER', 'AUDITOR', 'FINANCE_HEAD');
  const teamOnly = !u.roles.includes('AUDITOR') && !u.roles.includes('FINANCE_HEAD');
  const from = ctx.q.get('from');
  const to = ctx.q.get('to');
  return ctx.d.claims.filter((c) => {
    if (c.submittedAt === null || ['DRAFT', 'POLICY_REJECTED', 'REJECTED'].includes(c.status)) return false;
    if (teamOnly && ctx.d.user(c.employeeId)?.managerId !== u.id && c.employeeId !== u.id) return false;
    const day = istDate(c.submittedAt);
    return (!from || day >= from) && (!to || day <= to);
  });
}
const sumBy = (ctx: Ctx, claims: MClaim[], key: (c: MClaim, l: MLine) => string) => {
  const m = new Map<string, number>();
  for (const c of claims) for (const l of ctx.d.linesOf(c.id)) m.set(key(c, l), (m.get(key(c, l)) ?? 0) + toPaise(l.amount));
  return m;
};
on('GET', '/dashboard/spend-by-category', (ctx) => json([...sumBy(ctx, dashScope(ctx), (_c, l) => l.category)].map(([category, p]) => ({ category, total: fromPaise(p) }))));
on('GET', '/dashboard/spend-by-department', (ctx) =>
  json([...sumBy(ctx, dashScope(ctx), (c) => ctx.d.user(c.employeeId)?.department ?? '—')].map(([department, p]) => ({ department, total: fromPaise(p) }))),
);
on('GET', '/dashboard/spend-by-month', (ctx) => {
  const m = sumBy(ctx, dashScope(ctx), (c) => istDate(c.submittedAt ?? 0).slice(0, 7));
  const months: { month: string; total: string }[] = [];
  const d = new Date(ctx.now);
  for (let i = 11; i >= 0; i -= 1) {
    const key = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 15)).toISOString().slice(0, 7);
    months.push({ month: key, total: fromPaise(m.get(key) ?? 0) });
  }
  return json(months);
});
on('GET', '/dashboard/violations', (ctx) => {
  const ids = new Set(dashScope(ctx).map((c) => c.id));
  const m = new Map<string, number>();
  for (const r of ctx.d.results) if (ids.has(r.claimId)) m.set(r.ruleCode, (m.get(r.ruleCode) ?? 0) + 1);
  return json([...m].map(([ruleCode, count]) => ({ ruleCode, count })));
});
on('GET', '/dashboard/approval-time', (ctx) => {
  const m = new Map<string, { sum: number; n: number }>();
  for (const c of dashScope(ctx)) {
    if (c.approvedAt === null || c.submittedAt === null || !ctx.d.stepsOf(c.id).length) continue;
    const dept = ctx.d.user(c.employeeId)?.department ?? '—';
    const e = m.get(dept) ?? { sum: 0, n: 0 };
    e.sum += (c.approvedAt - c.submittedAt) / 3_600_000;
    e.n += 1;
    m.set(dept, e);
  }
  return json([...m].map(([department, e]) => ({ department, avgHours: Math.round((e.sum / e.n) * 10) / 10 })));
});
on('GET', '/dashboard/kpis', (ctx) => {
  const scope = dashScope(ctx);
  const pending = scope.filter((c) => c.status.startsWith('PENDING_'));
  const oldest = pending.reduce<number | null>((m, c) => {
    const a = ctx.d.currentStep(c.id)?.activatedAt;
    return a === undefined || a === null ? m : m === null ? a : Math.min(m, a);
  }, null);
  return json({ pendingClaims: pending.length, oldestPendingSeconds: oldest === null ? null : Math.floor((ctx.now - oldest) / 1000) });
});

// ---- audit
on('GET', '/audit', (ctx) => {
  const u = need(ctx);
  const q = ctx.q;
  const privileged = u.roles.includes('AUDITOR') || u.roles.includes('FINANCE_HEAD');
  const claimNo = q.get('claimNo');
  const claimId = q.get('claimId') ? Number(q.get('claimId')) : claimNo ? ctx.d.claims.find((c) => c.claimNo.toLowerCase() === claimNo.toLowerCase())?.id ?? -1 : null;
  if (!privileged && claimId === null) throw new MockError(403, 'Only auditors and the finance head can browse the full trail');
  if (claimId !== null && claimId > 0) visibleClaim(ctx, claimId);
  const from = q.get('from') ? Date.parse(q.get('from') as string) : null;
  const to = q.get('to') ? Date.parse(q.get('to') as string) : null;
  const actorId = q.get('actorId') ? Number(q.get('actorId')) : null;
  const rows = ctx.d.audit
    .filter((e) => (claimId === null || e.claimId === claimId) && (actorId === null || e.actorId === actorId) && (from === null || e.createdAt >= from) && (to === null || e.createdAt <= to))
    .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
    .map((e) => ({ id: e.id, entityType: e.entityType, entityId: e.entityId, action: e.action, actorId: e.actorId, actorName: ctx.d.name(e.actorId), onBehalfOfId: e.onBehalfOfId, onBehalfOfName: ctx.d.name(e.onBehalfOfId), before: e.before, after: e.after, requestId: e.requestId, createdAt: iso(e.createdAt) }));
  return json(pageOf(rows, Number(q.get('page') ?? 0) || 0, 50));
});

// ---- policy admin
on('GET', '/admin/policy-rules', (ctx) => {
  requireRole(need(ctx), 'AUDITOR', 'FINANCE_HEAD');
  const all = ctx.q.get('includeHistory') === 'true';
  const rules = all ? ctx.d.rules : ctx.d.activeRules(ctx.now);
  return json(rules.map(ruleDto));
});
on('POST', '/admin/policy-rules/([A-Z_]+)/versions', (ctx, [code]) => {
  const u = need(ctx);
  requireRole(u, 'FINANCE_HEAD');
  const b = ctx.body;
  const reason = str(b.reason).trim();
  if (reason.length < 3) throw new MockError(422, 'A reason is required', [{ field: 'reason', message: 'A reason is required for every rule change' }]);
  if (ctx.d.inFlightOf(u.id) > 0) throw new MockError(409, 'You have a claim in flight, so rules cannot be edited until it is decided');
  const category = (b.category ?? null) as PolicyRule['category'];
  const cityTier = (b.cityTier ?? null) as PolicyRule['cityTier'];
  const base = ctx.d.rules.filter((r) => r.ruleCode === code && (r.category ?? null) === category && (r.cityTier ?? null) === cityTier).sort((a, z) => z.version - a.version)[0];
  if (!base) throw new MockError(404, 'Rule not found');
  const limit = b.limitAmount === null || b.limitAmount === undefined || b.limitAmount === '' ? null : str(b.limitAmount);
  if (limit !== null && !isValidAmount(limit)) throw new MockError(422, 'Invalid limit', [{ field: 'limitAmount', message: 'Enter a positive amount' }]);
  const action = str(b.action) as PolicyRule['action'];
  if (!['AUTO_APPROVE', 'ROUTE', 'AUTO_REJECT'].includes(action)) throw new MockError(422, 'Invalid action', [{ field: 'action', message: 'Choose an action' }]);
  const rule = ctx.d.addRuleVersion(
    {
      ruleCode: base.ruleCode,
      category: base.category,
      cityTier: base.cityTier,
      limitAmount: limit === null ? null : fromPaise(toPaise(limit)),
      unit: base.unit,
      action,
      flag: base.flag,
      params: base.params,
      active: b.active !== false,
      effectiveFrom: str(b.effectiveFrom) || new Date(ctx.now).toISOString(),
      createdById: u.id,
      createdByName: u.name,
      reason,
    },
    ctx.now,
  );
  return json(ruleDto(rule), 201);
});

// ---------------------------------------------------------------- entry
export async function mockFetch(method: string, url: string, init: { headers: Headers; body?: BodyInit }): Promise<Response> {
  await latency();
  const d = getDb();
  const u = new URL(url);
  const path = u.pathname.replace(/^\/api/, '');
  const auth = init.headers.get('Authorization') ?? '';
  const tokenUser = /^Bearer mock-(\d+)$/.exec(auth);
  const me = tokenUser ? (d.user(Number(tokenUser[1])) ?? null) : null;

  let body: Record<string, unknown> = {};
  let form: FormData | null = null;
  if (init.body instanceof FormData) form = init.body;
  else if (typeof init.body === 'string' && init.body) {
    try {
      body = JSON.parse(init.body) as Record<string, unknown>;
    } catch {
      return problem(400, 'Malformed JSON');
    }
  }
  if (auth && !me) return problem(401, 'Your session is not valid in demo mode. Sign in again.');

  for (const [m, re, h] of routes) {
    if (m !== method) continue;
    const match = re.exec(path);
    if (!match) continue;
    try {
      return await h({ d, method, path, q: u.searchParams, body, form, me, now: Date.now() }, match.slice(1));
    } catch (e) {
      if (e instanceof MockError) return problem(e.status, e.message, e.errors);
      console.error('[mock]', e);
      return problem(500, 'Mock server error');
    }
  }
  return problem(404, `No mock route for ${method} ${path}`);
}

