/**
 * Demo mock mode: when on, the API client serves every `/api` call from an in-memory backend
 * (src/api/mock/server.ts) instead of the network. Per tab, like the session token.
 */
const KEY = 'ef.mockMode';

export function isMockMode(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function enableMockMode(): void {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    /* ignore */
  }
}

export function disableMockMode(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
