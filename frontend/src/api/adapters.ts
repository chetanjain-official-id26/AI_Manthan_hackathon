/**
 * Adapters from the Spring Boot response shapes to the UI types in ./types.ts.
 *
 * The backend returns a few resources in a different shape than the UI was written against
 * (e.g. ClaimDetail is nested as `{claim, lines, steps, comments, permissions}`). Each adapter
 * recognises the backend shape and converts it; anything already in the UI shape (the in-browser
 * demo mock, test fixtures) passes through unchanged.
 */
import type {
  ApprovalStep,
  AuditorQueueItem,
  ClaimAction,
  ClaimDetail,
  ClaimLine,
  ClaimSummary,
  Delegation,
  Flag,
  InboxItem,
  Me,
  PolicyResult,
} from './types';

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const arr = <T = Raw>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** Derive UI flags from the backend booleans when the payload has no `flags` array. */
function flagsOf(raw: Raw): Flag[] | undefined {
  if (Array.isArray(raw.flags)) return raw.flags as Flag[];
  const f: Flag[] = [];
  // SAMPLE is not added here: the UI renders it from `sampleAudit` directly.
  if (raw.splitSuspect === true) f.push('SPLIT_SUSPECT');
  return f;
}

function toResult(r: Raw, claimLineId: number): PolicyResult {
  return {
    ...(r as unknown as PolicyResult),
    claimLineId: num(r.claimLineId) ?? claimLineId,
    matchLineId: num(r.matchLineId) ?? num(r.relatedLineId),
  };
}

function toStep(s: Raw): ApprovalStep {
  return {
    ...(s as unknown as ApprovalStep),
    actedById: num(s.actedById) ?? num(s.actedBy),
    onBehalfOfId: num(s.onBehalfOfId) ?? num(s.onBehalfOf),
  };
}

function toLine(l: Raw): ClaimLine {
  const receipt = isObj(l.receipt) ? l.receipt : null;
  return {
    ...(l as unknown as ClaimLine),
    receiptId: num(l.receiptId) ?? (receipt ? num(receipt.id) : null),
  };
}

/** Backend `{claim, lines, steps, comments, permissions}` → flat UI ClaimDetail. */
export function toClaimDetail(raw: unknown): ClaimDetail {
  if (!isObj(raw) || !isObj(raw.claim)) return raw as ClaimDetail;
  const claim = raw.claim;
  const lines = arr(raw.lines);
  const perms = isObj(raw.permissions) ? raw.permissions : null;
  const allowedActions: ClaimAction[] | undefined = perms
    ? perms.canApprove === true
      ? ['APPROVE', 'REJECT', 'SEND_BACK', 'COMMENT']
      : ['COMMENT']
    : undefined;
  return {
    ...(claim as unknown as ClaimSummary),
    employeeId: claim.employeeId as number,
    flags: flagsOf(claim),
    lineCount: lines.length,
    lines: lines.map(toLine),
    policyResults: lines.flatMap((l) => arr(l.policyResults).map((r) => toResult(r, l.id as number))),
    approvalSteps: arr(raw.steps).map(toStep),
    comments: arr(raw.comments) as unknown as ClaimDetail['comments'],
    allowedActions,
  } as ClaimDetail;
}

/**
 * Line add/update returns the whole claim on the backend. Pick the saved line out of it:
 * the given lineId for an update, otherwise the newest line (highest id).
 */
export function toSavedLine(raw: unknown, lineId?: number): ClaimLine {
  if (!isObj(raw) || !Array.isArray(raw.lines)) return raw as ClaimLine;
  const lines = toClaimDetail(raw).lines;
  const hit = lineId != null ? lines.find((l) => l.id === lineId) : undefined;
  const newest = lines.reduce<ClaimLine | undefined>((a, b) => (!a || b.id > a.id ? b : a), undefined);
  return (hit ?? newest) as ClaimLine;
}

export function toClaimSummary(raw: unknown): ClaimSummary {
  if (!isObj(raw)) return raw as ClaimSummary;
  return { ...(raw as unknown as ClaimSummary), flags: flagsOf(raw) };
}

/** Backend `/me` exposes delegations the user acts under as `actingFor`. */
export function toMe(raw: unknown): Me {
  if (!isObj(raw) || raw.activeDelegations !== undefined || !Array.isArray(raw.actingFor)) return raw as Me;
  const meId = raw.id as number;
  const activeDelegations: Delegation[] = arr(raw.actingFor).map((d) => ({
    id: d.id as number,
    delegatorId: d.delegatorId as number,
    delegatorName: (d.delegatorName as string | undefined) ?? undefined,
    delegateId: meId,
    // The backend only lists delegations that are active now, so they started on or before today.
    fromDate: '0000-01-01',
    toDate: String(d.toDate ?? '9999-12-31').slice(0, 10),
    revoked: false,
  }));
  return { ...(raw as unknown as Me), activeDelegations };
}

function ageSecondsOf(raw: Raw): number | null {
  return num(raw.ageSeconds) ?? (num(raw.ageHours) != null ? (raw.ageHours as number) * 3600 : null);
}

export function toInboxItem(raw: unknown): InboxItem {
  if (!isObj(raw)) return raw as InboxItem;
  return {
    ...(raw as unknown as InboxItem),
    version: num(raw.version) ?? (raw.claimVersion as number),
    onBehalfOfId: num(raw.onBehalfOfId) ?? num(raw.onBehalfOf),
    ageSeconds: ageSecondsOf(raw),
    flags: flagsOf(raw),
  };
}

export function toAuditorItem(raw: unknown): AuditorQueueItem {
  if (!isObj(raw)) return raw as AuditorQueueItem;
  return {
    ...(raw as unknown as AuditorQueueItem),
    activatedAt: (raw.activatedAt as string | undefined) ?? (raw.pendingSince as string | null | undefined) ?? null,
    ageSeconds: ageSecondsOf(raw),
  };
}

/** Dashboard rows come back as `{key, …}`; rename `key` to the field the chart reads. */
export function renameKey<T>(field: string) {
  return (raw: unknown): T => {
    if (!isObj(raw) || raw[field] !== undefined || raw.key === undefined) return raw as T;
    const { key, ...rest } = raw;
    return { ...rest, [field]: key } as T;
  };
}
