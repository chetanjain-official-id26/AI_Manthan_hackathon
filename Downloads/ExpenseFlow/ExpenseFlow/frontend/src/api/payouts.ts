import { request, requestBlob, requestList } from './client';
import type { ClaimSummary, PayoutBatch } from './types';

export const payoutsApi = {
  /** Not listed in LLD §6, but the S5 batch list needs it (see README "API gaps"). */
  list: () => requestList<PayoutBatch>('/payouts'),
  eligible: () => requestList<ClaimSummary>('/payouts/eligible'),
  create: (claimIds: number[]) => request<PayoutBatch>('/payouts', { method: 'POST', body: { claimIds } }),
  get: (id: number) => request<PayoutBatch>(`/payouts/${id}`),
  csv: (id: number) => requestBlob(`/payouts/${id}/csv`),
  markPaid: (id: number, version: number) =>
    request<PayoutBatch>(`/payouts/${id}/mark-paid`, { method: 'POST', body: { version } }),
  void: (id: number, reason: string) => request<PayoutBatch>(`/payouts/${id}/void`, { method: 'POST', body: { reason } }),
};
