import { renameKey } from './adapters';
import { ApiError, request, requestList } from './client';
import type {
  ApprovalTime,
  DashboardKpis,
  SpendByCategory,
  SpendByDepartment,
  SpendByMonth,
  ViolationCount,
} from './types';

export interface DateRange {
  from?: string;
  to?: string;
}

export const dashboardApi = {
  // The backend returns `{key, total|count|avgHours}` rows; renameKey maps `key` to the field each chart reads.
  spendByCategory: (r: DateRange) =>
    requestList<unknown>('/dashboard/spend-by-category', { query: { ...r } }).then((l) =>
      l.map(renameKey<SpendByCategory>('category')),
    ),
  spendByDepartment: (r: DateRange) =>
    requestList<unknown>('/dashboard/spend-by-department', { query: { ...r } }).then((l) =>
      l.map(renameKey<SpendByDepartment>('department')),
    ),
  spendByMonth: (r: DateRange) =>
    requestList<unknown>('/dashboard/spend-by-month', { query: { ...r } }).then((l) =>
      l.map(renameKey<SpendByMonth>('month')),
    ),
  violations: (r: DateRange) =>
    requestList<unknown>('/dashboard/violations', { query: { ...r } }).then((l) =>
      l.map(renameKey<ViolationCount>('ruleCode')),
    ),
  approvalTime: (r: DateRange) =>
    requestList<unknown>('/dashboard/approval-time', { query: { ...r } }).then((l) =>
      l.map(renameKey<ApprovalTime>('department')),
    ),
  /** Optional endpoint (not in LLD §6). Resolves to null when the backend does not provide it. */
  kpis: async (r: DateRange): Promise<DashboardKpis | null> => {
    try {
      return await request<DashboardKpis>('/dashboard/kpis', { query: { ...r } });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
      throw e;
    }
  },
};
