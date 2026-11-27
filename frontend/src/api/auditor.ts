import { request, requestPage } from './client';
import type { AuditorQueueFilters, AuditorQueueItem, BulkApproveResult } from './types';

export const auditorApi = {
  queue: (f: AuditorQueueFilters) =>
    requestPage<AuditorQueueItem>('/auditor/queue', {
      query: {
        dept: f.dept,
        category: f.category,
        min: f.min,
        max: f.max,
        flag: f.flag,
        sample: f.sample ? true : undefined,
        ageDays: f.ageDays,
        sort: f.sort ?? '-age',
        page: f.page ?? 0,
      },
    }),
  bulkApprove: (items: { claimId: number; version: number }[]) =>
    request<BulkApproveResult[]>('/auditor/bulk-approve', { method: 'POST', body: { items } }),
};
