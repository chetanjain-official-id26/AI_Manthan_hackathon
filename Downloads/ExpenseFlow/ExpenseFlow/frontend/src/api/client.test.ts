import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/server';
import { api, ok, problem } from '@/test/render';
import { ApiError, buildQuery, errorMessage, extractFieldErrors, NetworkError, parseFileName, request, requestBlob, setUnauthorizedHandler, toPage, tokenStore } from './client';

describe('api client', () => {
  it('TC-FE-A01 attaches the bearer token', async () => {
    tokenStore.set('abc', new Date(Date.now() + 60_000).toISOString());
    let auth: string | null = null;
    server.use(
      http.get(api('/me'), ({ request: r }) => {
        auth = r.headers.get('Authorization');
        return ok({ id: 1 });
      }),
    );
    await request('/me');
    expect(auth).toBe('Bearer abc');
  });

  it('TC-FE-A02 does not send a token to public endpoints', async () => {
    tokenStore.set('abc');
    let auth: string | null = 'unset';
    server.use(
      http.get(api('/auth/demo-users'), ({ request: r }) => {
        auth = r.headers.get('Authorization');
        return ok([]);
      }),
    );
    await request('/auth/demo-users', { anonymous: true });
    expect(auth).toBeNull();
  });

  it('TC-FE-A03 parses RFC 7807 problems with field errors (422)', async () => {
    server.use(http.post(api('/claims/1/lines'), () => problem(422, 'Validation failed', { errors: [{ field: 'amount', message: 'must be > 0' }] })));
    const err = await request('/claims/1/lines', { method: 'POST', body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.status).toBe(422);
    expect(e.isValidation).toBe(true);
    expect(e.fieldErrors).toEqual({ amount: 'must be > 0' });
    expect(errorMessage(e)).toBe('Validation failed');
  });

  it('TC-FE-A04 409 maps to the "updated by someone else" message', async () => {
    server.use(http.post(api('/claims/1/approve'), () => problem(409, 'stale version')));
    const e = (await request('/claims/1/approve', { method: 'POST', body: { version: 1 } }).catch((x: unknown) => x)) as ApiError;
    expect(e.isConflict).toBe(true);
    expect(errorMessage(e)).toMatch(/updated by someone else/);
  });

  it('TC-FE-A05 401 clears the token and calls the unauthorized handler', async () => {
    tokenStore.set('abc');
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    server.use(http.get(api('/me'), () => problem(401, 'expired')));
    await expect(request('/me')).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledOnce();
    expect(tokenStore.get()).toBeNull();
    expect(tokenStore.logoutReason()).toBe('unauthorized');
    setUnauthorizedHandler(null);
  });

  it('TC-FE-A06 network failure becomes NetworkError', async () => {
    server.use(http.get(api('/me'), () => HttpResponse.error()));
    await expect(request('/me')).rejects.toBeInstanceOf(NetworkError);
  });

  it('TC-FE-A07 expired token is dropped before sending', () => {
    tokenStore.set('old', new Date(Date.now() - 1000).toISOString());
    expect(tokenStore.get()).toBeNull();
    expect(tokenStore.logoutReason()).toBe('expired');
  });

  it('TC-FE-A08 normalises Spring Page, PagedModel and arrays', () => {
    expect(toPage({ content: [1, 2], number: 1, size: 2, totalElements: 4, totalPages: 2 })).toEqual({ content: [1, 2], page: 1, size: 2, totalElements: 4, totalPages: 2 });
    expect(toPage({ content: [1], page: { number: 0, size: 50, totalElements: 1, totalPages: 1 } })).toEqual({ content: [1], page: 0, size: 50, totalElements: 1, totalPages: 1 });
    expect(toPage([1, 2, 3]).totalElements).toBe(3);
    expect(toPage(null).content).toEqual([]);
  });

  it('TC-FE-A09 query builder drops empty values; field errors from all RFC 7807 shapes', () => {
    expect(buildQuery({ a: 1, b: '', c: undefined, d: false, e: true })).toBe('?a=1&e=true');
    expect(extractFieldErrors({ invalidParams: [{ name: 'reason', reason: 'required' }] })).toEqual({ reason: 'required' });
    expect(extractFieldErrors({ fieldErrors: { title: 'blank' } })).toEqual({ title: 'blank' });
  });

  it('TC-FE-A10 CSV download keeps the server file name', async () => {
    tokenStore.set('abc');
    server.use(
      http.get(api('/payouts/12/csv'), () =>
        new HttpResponse('H,12\n', { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="EXPF_20261127_12.csv"' } }),
      ),
    );
    const { fileName, blob } = await requestBlob('/payouts/12/csv');
    expect(fileName).toBe('EXPF_20261127_12.csv');
    expect(await blob.text()).toBe('H,12\n');
    expect(parseFileName("attachment; filename*=UTF-8''EXPF%20a.csv")).toBe('EXPF a.csv');
  });
});
