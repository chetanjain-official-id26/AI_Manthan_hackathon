import type { ApprovalStep, ClaimDetail, Delegation, Me, Role } from '@/api/types';
import { LEVEL_LABEL } from '@/utils/labels';
import { todayIST } from '@/utils/time';

export const ROLE_RANK: Record<Role, number> = { EMPLOYEE: 0, MANAGER: 1, AUDITOR: 2, FINANCE_HEAD: 3 };

export function primaryRole(roles: Role[] | undefined): Role {
  if (!roles || roles.length === 0) return 'EMPLOYEE';
  return [...roles].sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a])[0] ?? 'EMPLOYEE';
}

export function hasRole(me: Me | null | undefined, ...roles: Role[]): boolean {
  return !!me && roles.some((r) => me.roles.includes(r));
}

export function isDelegationActive(d: Delegation, today = todayIST()): boolean {
  return !d.revoked && d.fromDate <= today && today <= d.toDate;
}

/** Delegations where `me` is the active delegate (I may act for the delegator). */
export function actingFor(me: Me | null | undefined): Delegation[] {
  if (!me) return [];
  return (me.activeDelegations ?? []).filter((d) => d.delegateId === me.id && isDelegationActive(d));
}

export function isApprover(me: Me | null | undefined): boolean {
  return hasRole(me, 'MANAGER', 'AUDITOR', 'FINANCE_HEAD') || actingFor(me).length > 0;
}

/** Every persona lands on the role home (EF-035), which lists that persona's tasks. */
export function homePath(_me?: Me | null): string {
  return '/home';
}

export function currentStep(claim: ClaimDetail): ApprovalStep | undefined {
  const pending = claim.approvalSteps.filter((s) => s.status === 'PENDING');
  if (pending.length === 0) return undefined;
  return pending.reduce((a, b) => ((b.cycleNo ?? 0) > (a.cycleNo ?? 0) ? b : a));
}

export interface ActionPermission {
  canAct: boolean;
  isOwner: boolean;
  /** Name of the person the user would act on behalf of (delegation). */
  onBehalfOf?: string;
  /** Read-only explanation shown when the user cannot act. */
  reason?: string;
}

/**
 * Client-side mirror of the server rules (BR-17, BR-18, LLD §2.1). The server is the authority;
 * this only decides which controls to render. The owner never gets approve/reject/send-back.
 */
export function actionPermission(me: Me | null | undefined, claim: ClaimDetail): ActionPermission {
  if (!me) return { canAct: false, isOwner: false };
  const isOwner = claim.employeeId === me.id;
  if (isOwner) {
    return {
      canAct: false,
      isOwner,
      reason: 'This is your own claim. Nobody can approve or reject their own claim, even as a delegate.',
    };
  }
  const step = currentStep(claim);
  const pendingStatus = claim.status.startsWith('PENDING_');
  if (!step || !pendingStatus) {
    return { canAct: false, isOwner, reason: 'This claim is not waiting for approval.' };
  }

  const waiting = `Waiting for ${LEVEL_LABEL[step.level].toLowerCase()}${step.assigneeName ? ` (${step.assigneeName})` : ''}.`;

  if (claim.allowedActions) {
    const ok = claim.allowedActions.includes('APPROVE');
    return { canAct: ok, isOwner, reason: ok ? undefined : waiting, onBehalfOf: ok ? delegatorName(me, step) : undefined };
  }

  if (step.assigneeId === me.id) return { canAct: true, isOwner };
  if (step.assigneeId == null) {
    if (step.level === 'AUDITOR' && hasRole(me, 'AUDITOR')) return { canAct: true, isOwner };
    if (step.level === 'FINANCE_HEAD' && hasRole(me, 'FINANCE_HEAD')) return { canAct: true, isOwner };
  }
  const name = delegatorName(me, step);
  if (name !== undefined) return { canAct: true, isOwner, onBehalfOf: name };
  return { canAct: false, isOwner, reason: waiting };
}

function delegatorName(me: Me, step: ApprovalStep): string | undefined {
  if (step.assigneeId == null) return undefined;
  const d = actingFor(me).find((x) => x.delegatorId === step.assigneeId);
  return d ? (d.delegatorName ?? step.assigneeName ?? `user #${d.delegatorId}`) : undefined;
}
