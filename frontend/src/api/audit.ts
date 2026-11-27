import { requestPage } from './client';
import type { AuditEvent } from './types';

export interface AuditFilters {
  claimId?: string;
  claimNo?: string;
  actorId?: string;
  from?: string;
  to?: string;
  page?: number;
}

export const auditApi = {
  list: (f: AuditFilters) => requestPage<AuditEvent>('/audit', { query: { ...f, page: f.page ?? 0 } }),
};
