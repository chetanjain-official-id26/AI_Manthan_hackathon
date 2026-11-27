import { request, requestPage } from './client';
import type {
  ClaimDetail,
  ClaimLine,
  ClaimStatus,
  ClaimSummary,
  LineInput,
  PolicyPreviewResponse,
  ReceiptUploadResponse,
} from './types';

function linePayload(l: LineInput) {
  return {
    category: l.category,
    amount: l.amount,
    expenseDate: l.expenseDate,
    vendor: l.vendor.trim(),
    city: l.city.trim(),
    cityTier: l.cityTier,
    nights: l.category === 'HOTEL' ? l.nights : null,
    description: l.description.trim(),
  };
}

export const claimsApi = {
  list: (params: { mine?: boolean; status?: ClaimStatus | ''; page?: number }) =>
    requestPage<ClaimSummary>('/claims', {
      query: { mine: params.mine ?? true, status: params.status ?? '', page: params.page ?? 0 },
    }),
  create: (title: string) => request<ClaimDetail>('/claims', { method: 'POST', body: { title } }),
  get: (id: number) => request<ClaimDetail>(`/claims/${id}`),
  update: (id: number, title: string, version: number) =>
    request<ClaimDetail>(`/claims/${id}`, { method: 'PATCH', body: { title, version } }),

  addLine: (id: number, line: LineInput) =>
    request<ClaimLine>(`/claims/${id}/lines`, { method: 'POST', body: linePayload(line) }),
  updateLine: (id: number, lineId: number, line: LineInput) =>
    request<ClaimLine>(`/claims/${id}/lines/${lineId}`, { method: 'PUT', body: linePayload(line) }),
  deleteLine: (id: number, lineId: number) => request<void>(`/claims/${id}/lines/${lineId}`, { method: 'DELETE' }),

  uploadReceipt: (id: number, lineId: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ReceiptUploadResponse>(`/claims/${id}/lines/${lineId}/receipt`, { method: 'POST', form });
  },

  policyPreview: (id: number, signal?: AbortSignal) =>
    request<PolicyPreviewResponse>(`/claims/${id}/policy-preview`, { method: 'POST', signal }),
  submit: (id: number, version: number) =>
    request<ClaimDetail>(`/claims/${id}/submit`, { method: 'POST', body: { version } }),

  approve: (id: number, version: number, note?: string) =>
    request<ClaimDetail>(`/claims/${id}/approve`, { method: 'POST', body: note ? { version, note } : { version } }),
  reject: (id: number, version: number, reason: string) =>
    request<ClaimDetail>(`/claims/${id}/reject`, { method: 'POST', body: { version, reason } }),
  sendBack: (id: number, version: number, comment: string) =>
    request<ClaimDetail>(`/claims/${id}/send-back`, { method: 'POST', body: { version, comment } }),
  comment: (id: number, body: string) => request<unknown>(`/claims/${id}/comments`, { method: 'POST', body: { body } }),
};

export const receiptPath = (receiptId: number) => `/receipts/${receiptId}`;
