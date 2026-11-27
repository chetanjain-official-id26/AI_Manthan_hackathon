import { toClaimDetail, toClaimSummary, toSavedLine } from './adapters';
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
  list: async (params: { mine?: boolean; status?: ClaimStatus | ''; page?: number }) => {
    const page = await requestPage<ClaimSummary>('/claims', {
      query: { mine: params.mine ?? true, status: params.status ?? '', page: params.page ?? 0 },
    });
    return { ...page, content: page.content.map(toClaimSummary) };
  },
  create: (title: string): Promise<ClaimDetail> =>
    request<unknown>('/claims', { method: 'POST', body: { title } }).then(toClaimDetail),
  get: (id: number): Promise<ClaimDetail> => request<unknown>(`/claims/${id}`).then(toClaimDetail),
  update: (id: number, title: string, version: number): Promise<ClaimDetail> =>
    request<unknown>(`/claims/${id}`, { method: 'PATCH', body: { title, version } }).then(toClaimDetail),

  // The backend returns the whole claim after a line save; pick out the saved line.
  addLine: (id: number, line: LineInput): Promise<ClaimLine> =>
    request<unknown>(`/claims/${id}/lines`, { method: 'POST', body: linePayload(line) }).then((r) => toSavedLine(r)),
  updateLine: (id: number, lineId: number, line: LineInput): Promise<ClaimLine> =>
    request<unknown>(`/claims/${id}/lines/${lineId}`, { method: 'PUT', body: linePayload(line) }).then((r) =>
      toSavedLine(r, lineId),
    ),
  deleteLine: (id: number, lineId: number) => request<void>(`/claims/${id}/lines/${lineId}`, { method: 'DELETE' }),

  uploadReceipt: (id: number, lineId: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ReceiptUploadResponse>(`/claims/${id}/lines/${lineId}/receipt`, { method: 'POST', form });
  },

  policyPreview: (id: number, signal?: AbortSignal) =>
    request<PolicyPreviewResponse>(`/claims/${id}/policy-preview`, { method: 'POST', signal }),
  submit: (id: number, version: number): Promise<ClaimDetail> =>
    request<unknown>(`/claims/${id}/submit`, { method: 'POST', body: { version } }).then(toClaimDetail),

  approve: (id: number, version: number, note?: string): Promise<ClaimDetail> =>
    request<unknown>(`/claims/${id}/approve`, { method: 'POST', body: note ? { version, note } : { version } }).then(
      toClaimDetail,
    ),
  reject: (id: number, version: number, reason: string): Promise<ClaimDetail> =>
    request<unknown>(`/claims/${id}/reject`, { method: 'POST', body: { version, reason } }).then(toClaimDetail),
  sendBack: (id: number, version: number, comment: string): Promise<ClaimDetail> =>
    request<unknown>(`/claims/${id}/send-back`, { method: 'POST', body: { version, comment } }).then(toClaimDetail),
  comment: (id: number, body: string) => request<unknown>(`/claims/${id}/comments`, { method: 'POST', body: { body } }),
};

export const receiptPath = (receiptId: number) => `/receipts/${receiptId}`;
