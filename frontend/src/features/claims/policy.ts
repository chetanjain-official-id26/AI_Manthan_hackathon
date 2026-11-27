import type { ClaimDetail, ClaimLine, Flag, PolicyOutcome, PolicyPreviewResponse, PolicyResult } from '@/api/types';

export interface LinePolicy {
  outcome: PolicyOutcome | null;
  results: PolicyResult[];
}

const RANK: Record<PolicyOutcome, number> = { AUTO_APPROVE: 0, ROUTE: 1, AUTO_REJECT: 2 };

export function worst(outcomes: (PolicyOutcome | null | undefined)[]): PolicyOutcome | null {
  let w: PolicyOutcome | null = null;
  for (const o of outcomes) {
    if (!o) continue;
    if (w === null || RANK[o] > RANK[w]) w = o;
  }
  return w;
}

/** Latest evaluation only — older evaluations (before a resubmit) are ignored. */
function latestResults(results: PolicyResult[]): PolicyResult[] {
  const maxEval = results.reduce((m, r) => Math.max(m, r.evaluationNo ?? 0), 0);
  return maxEval === 0 ? results : results.filter((r) => (r.evaluationNo ?? 0) === maxEval);
}

/** Per-line policy, preferring a fresh preview, then the persisted results on the claim. */
export function linePolicies(claim: ClaimDetail, preview?: PolicyPreviewResponse | null): Map<number, LinePolicy> {
  const map = new Map<number, LinePolicy>();
  const persisted = latestResults(claim.policyResults ?? []);
  for (const line of claim.lines) {
    const p = preview?.lines.find((l) => l.lineId === line.id);
    if (p) {
      map.set(line.id, { outcome: p.outcome, results: p.results });
    } else {
      const results = persisted.filter((r) => r.claimLineId === line.id);
      map.set(line.id, { outcome: line.lineOutcome ?? worst(results.map((r) => r.outcome)), results });
    }
  }
  return map;
}

export function lineFlags(results: PolicyResult[]): Flag[] {
  const set = new Set<Flag>();
  for (const r of results) if (r.flag) set.add(r.flag);
  return [...set];
}

export function claimFlags(claim: ClaimDetail): Flag[] {
  const set = new Set<Flag>(claim.flags ?? []);
  for (const r of latestResults(claim.policyResults ?? [])) if (r.flag) set.add(r.flag);
  if (claim.sampleAudit) set.add('SAMPLE');
  return [...set];
}

export function lineReceiptId(line: ClaimLine): number | null {
  return line.receipt?.id ?? line.receipt?.receiptId ?? line.receiptId ?? null;
}

export function isEditable(claim: Pick<ClaimDetail, 'status'>): boolean {
  return claim.status === 'DRAFT' || claim.status === 'SENT_BACK';
}

export function claimHref(c: Pick<ClaimDetail, 'id' | 'status'>): string {
  return isEditable(c) ? `/claims/${c.id}/edit` : `/claims/${c.id}`;
}
