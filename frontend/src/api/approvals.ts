import { toInboxItem } from './adapters';
import { request, requestList } from './client';
import type { Delegation, InboxItem } from './types';

export const approvalsApi = {
  inbox: (): Promise<InboxItem[]> =>
    requestList<unknown>('/approvals/inbox', { query: { sort: 'age' } }).then((l) => l.map(toInboxItem)),
};

export interface DelegationInput {
  delegateId: number;
  fromDate: string;
  toDate: string;
  reason: string;
}

export const delegationsApi = {
  list: () => requestList<Delegation>('/delegations'),
  create: (input: DelegationInput) => request<Delegation>('/delegations', { method: 'POST', body: input }),
  revoke: (id: number) => request<void>(`/delegations/${id}`, { method: 'DELETE' }),
};
