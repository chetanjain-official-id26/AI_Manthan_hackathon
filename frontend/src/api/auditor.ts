import { toAuditorItem } from './adapters';
import { request, requestPage } from './client';
import type { AuditorQueueFilters, AuditorQueueItem, BulkApproveResult, QueueSort } from './types';

/**
 * UI sort keys -> backend QueueSort (AGE = oldest pending first, AMOUNT_DESC, AMOUNT_ASC).
 * The backend has no "newest pending first", so both age directions use AGE.
 */
const SORT_PARAM: Record<QueueSort, string> = {
  age: 'AGE',
  '-age': 'AGE',
  amount: 'AMOUNT_ASC',
  '-amount': 'AMOUNT_DESC',
};

export const auditorApi = {
  queue: async (f: AuditorQueueFilters) => {
    const page = await requestPage<AuditorQueueItem>('/auditor/queue', {
      query: {
        dept: f.dept,
        category: f.category,
        min: f.min,
        max: f.max,
        flag: f.flag,
        sample: f.sample ? true : undefined,
        ageDays: f.ageDays,
        sort: SORT_PARAM[f.sort ?? '-age'],
        page: f.page ?? 0,
      },
    });
    return { ...page, content: page.content.map(toAuditorItem) };
  },
  bulkApprove: (items: { claimId: number; version: number }[]) =>
    request<BulkApproveResult[]>('/auditor/bulk-approve', { method: 'POST', body: { items } }),
};
