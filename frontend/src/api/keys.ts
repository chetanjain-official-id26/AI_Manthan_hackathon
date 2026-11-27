/** Central TanStack Query keys so invalidation stays consistent. */
export const qk = {
  me: ['me'] as const,
  demoUsers: ['demo-users'] as const,
  claims: ['claims'] as const,
  claimList: (scope: string, status: string, page: number) => ['claims', 'list', scope, status, page] as const,
  claim: (id: number) => ['claims', 'detail', id] as const,
  preview: (id: number) => ['claims', 'preview', id] as const,
  inbox: ['inbox'] as const,
  delegations: ['delegations'] as const,
  auditorQueue: ['auditor-queue'] as const,
  payouts: ['payouts'] as const,
  payout: (id: number) => ['payouts', 'detail', id] as const,
  eligible: ['payouts', 'eligible'] as const,
  dashboard: ['dashboard'] as const,
  audit: ['audit'] as const,
  policies: ['policies'] as const,
};
