import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { tokenStore } from '@/api/client';
import type { Me, Page } from '@/api/types';
import { AuthProvider } from '@/features/auth/AuthContext';
import { ToastProvider } from '@/components/ui/Toast';
import App from '@/App';
import { server } from './server';

export const api = (path: string) => `*/api${path}`;

/** Shorthand JSON responders. */
export const ok = <T,>(body: T, status = 200) => HttpResponse.json(body as object, { status });
export const problem = (status: number, detail: string, extra: Record<string, unknown> = {}) =>
  HttpResponse.json({ status, title: 'Error', detail, ...extra }, { status, headers: { 'Content-Type': 'application/problem+json' } });

export const emptyPage = <T,>(): Page<T> => ({ content: [], page: 0, size: 50, totalElements: 0, totalPages: 0 });

export function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 }, mutations: { retry: false } },
  });
}

/** Signs the given persona in: stores a token and serves `/api/me`. */
export function signIn(me: Me): void {
  tokenStore.set('test-token', new Date(Date.now() + 3600_000).toISOString());
  server.use(http.get(api('/me'), () => ok(me)));
}

function LocationProbe() {
  const loc = useLocation();
  return (
    <div data-testid="location" hidden>
      {loc.pathname}
      {loc.search}
    </div>
  );
}

/** Renders the whole app (routes, guards, shell) at `route`. */
export function renderApp(route: string, opts: { me?: Me } = {}): RenderResult & { client: QueryClient } {
  if (opts.me) signIn(opts.me);
  const client = newQueryClient();
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <ToastProvider>
          <AuthProvider>
            <App />
            <LocationProbe />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

/** Renders a single element inside providers (no guards), at an optional path pattern. */
export function renderWithProviders(
  ui: ReactElement,
  opts: { route?: string; path?: string; me?: Me } = {},
): RenderResult & { client: QueryClient } {
  if (opts.me) signIn(opts.me);
  const client = newQueryClient();
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[opts.route ?? '/']}>
        <ToastProvider>
          <AuthProvider>
            <Routes>
              <Route path={opts.path ?? '*'} element={ui} />
              <Route path="*" element={<LocationProbe />} />
            </Routes>
            <LocationProbe />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

export function currentPath(): string {
  const els = document.querySelectorAll('[data-testid="location"]');
  return els[els.length - 1]?.textContent ?? '';
}
