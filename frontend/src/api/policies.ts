import { request, requestList } from './client';
import type { PolicyRule, PolicyRuleVersionInput } from './types';

export const policiesApi = {
  list: (includeHistory = false) => requestList<PolicyRule>('/admin/policy-rules', { query: { includeHistory } }),
  createVersion: (ruleCode: string, input: PolicyRuleVersionInput) =>
    request<PolicyRule>(`/admin/policy-rules/${encodeURIComponent(ruleCode)}/versions`, {
      method: 'POST',
      body: input,
    }),
};
