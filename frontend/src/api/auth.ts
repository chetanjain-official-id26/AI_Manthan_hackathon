import { request, requestList } from './client';
import type { DemoUser, LoginResponse, Me } from './types';

export const authApi = {
  demoUsers: () => requestList<DemoUser>('/auth/demo-users', { anonymous: true }),
  demoLogin: (employeeId: number) =>
    request<LoginResponse>('/auth/demo-login', { method: 'POST', body: { employeeId }, anonymous: true }),
  me: () => request<Me>('/me'),
};
