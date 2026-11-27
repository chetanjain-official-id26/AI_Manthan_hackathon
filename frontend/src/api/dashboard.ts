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
  spendByCategory: (r: DateRange) => requestList<SpendByCategory>('/dashboard/spend-by-category', { query: { ...r } }),
  spendByDepartment: (r: DateRange) =>
    requestList<SpendByDepartment>('/dashboard/spend-by-department', { query: { ...r } }),
  spendByMonth: (r: DateRange) => requestList<SpendByMonth>('/dashboard/spend-by-month', { query: { ...r } }),
  violations: (r: DateRange) => requestList<ViolationCount>('/dashboard/violations', { query: { ...r } }),
  approvalTime: (r: DateRange) => requestList<ApprovalTime>('/dashboard/approval-time', { query: { ...r } }),
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
