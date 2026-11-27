import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { ALL_USERS } from './fixtures';

const empty = { content: [], page: 0, size: 50, totalElements: 0, totalPages: 0 };

// 1×1 transparent PNG
const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
);

/**
 * Default "empty system" responses for background queries. Tests override what they assert on with
 * `server.use(...)`; anything not listed here or in a test fails with onUnhandledRequest: 'error'.
 */
export const defaultHandlers = [
  http.get('*/api/me', () => HttpResponse.json({ status: 401, title: 'Unauthorized' }, { status: 401 })),
  http.get('*/api/auth/demo-users', () => HttpResponse.json(ALL_USERS)),
  http.get('*/api/claims', () => HttpResponse.json(empty)),
  http.get('*/api/approvals/inbox', () => HttpResponse.json([])),
  http.get('*/api/delegations', () => HttpResponse.json([])),
  http.get('*/api/auditor/queue', () => HttpResponse.json(empty)),
  http.get('*/api/payouts/eligible', () => HttpResponse.json([])),
  http.get('*/api/payouts', () => HttpResponse.json([])),
  http.get('*/api/admin/policy-rules', () => HttpResponse.json([])),
  http.get('*/api/audit', () => HttpResponse.json(empty)),
  http.get('*/api/receipts/:id', () => new HttpResponse(PNG, { headers: { 'Content-Type': 'image/png' } })),
  http.post('*/api/claims/:id/policy-preview', () => HttpResponse.json({ claimOutcome: 'AUTO_APPROVE', lines: [] })),
];

export const server = setupServer(...defaultHandlers);
