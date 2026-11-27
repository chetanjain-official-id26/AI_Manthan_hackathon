import type { Page, ProblemDetail, ProblemFieldError } from './types';
import { isMockMode } from './mock/mode';

const BASE = '/api';
const TOKEN_KEY = 'ef.token';
const EXPIRY_KEY = 'ef.tokenExpiresAt';
const REASON_KEY = 'ef.logoutReason';

export type LogoutReason = 'expired' | 'unauthorized';

let memoryToken: string | null = null;
let memoryExpiry: number | null = null;

function safeGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable: values live only for this page load */
  }
}

// ---------------- token storage ----------------
// sessionStorage (not localStorage) so each browser tab can be signed in as a different demo user.
export const tokenStore = {
  get(): string | null {
    const token = safeGet(TOKEN_KEY) ?? memoryToken;
    if (token && tokenStore.isExpired()) {
      tokenStore.clear('expired');
      return null;
    }
    return token;
  },
  set(token: string, expiresAt?: string | null): void {
    memoryToken = token;
    const ms = expiresAt ? Date.parse(expiresAt) : NaN;
    memoryExpiry = Number.isFinite(ms) ? ms : null;
    safeSet(TOKEN_KEY, token);
    safeSet(EXPIRY_KEY, memoryExpiry !== null ? String(memoryExpiry) : null);
    safeSet(REASON_KEY, null);
  },
  /** Epoch ms when the JWT expires, or null when unknown. */
  expiresAt(): number | null {
    const raw = safeGet(EXPIRY_KEY);
    const v = raw !== null ? Number(raw) : memoryExpiry;
    return v !== null && Number.isFinite(v) ? v : null;
  },
  isExpired(now = Date.now()): boolean {
    const exp = tokenStore.expiresAt();
    return exp !== null && now >= exp;
  },
  clear(reason?: LogoutReason): void {
    memoryToken = null;
    memoryExpiry = null;
    safeSet(TOKEN_KEY, null);
    safeSet(EXPIRY_KEY, null);
    safeSet(REASON_KEY, reason ?? null);
  },
  /** Reason for the last forced logout; cleared by the next sign-in or manual logout. */
  logoutReason(): LogoutReason | null {
    const r = safeGet(REASON_KEY);
    return r === 'expired' || r === 'unauthorized' ? r : null;
  },
};

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

// ---------------- errors ----------------
export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetail;
  readonly fieldErrors: Record<string, string>;

  constructor(status: number, problem: ProblemDetail) {
    super(problem.detail ?? problem.title ?? `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
    this.fieldErrors = extractFieldErrors(problem);
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
  get isConflict(): boolean {
    return this.status === 409;
  }
  get isValidation(): boolean {
    return this.status === 422 || this.status === 400;
  }
  get isForbidden(): boolean {
    return this.status === 403;
  }
}

/** Network failure (server unreachable, CORS, offline). */
export class NetworkError extends Error {
  constructor() {
    super('Cannot reach the server. Check your connection and retry.');
    this.name = 'NetworkError';
  }
}

function collect(list: ProblemFieldError[] | Record<string, string> | undefined, out: Record<string, string>): void {
  if (!list) return;
  if (Array.isArray(list)) {
    for (const e of list) {
      const key = e.field ?? e.name;
      const msg = e.message ?? e.reason;
      if (key && msg && !(key in out)) out[key] = msg;
    }
  } else {
    for (const [k, v] of Object.entries(list)) {
      if (typeof v === 'string' && !(k in out)) out[k] = v;
    }
  }
}

export function extractFieldErrors(p: ProblemDetail): Record<string, string> {
  const out: Record<string, string> = {};
  collect(p.errors, out);
  collect(p.fieldErrors, out);
  collect(p.invalidParams, out);
  return out;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return 'This record was updated by someone else. Refresh to see the latest state.';
    return err.problem.detail ?? err.problem.title ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong.';
}

// ---------------- request core ----------------
type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

export function buildQuery(q?: Query): string {
  if (!q) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Absolute URL for an API path (same origin in the browser; also works under Node test runners). */
export function apiUrl(pathAndQuery: string): string {
  const origin = typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null' ? window.location.origin : 'http://localhost';
  return `${origin}${BASE}${pathAndQuery}`;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Query;
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
  /** Do not attach the bearer token (public endpoints). */
  anonymous?: boolean;
}

async function rawFetch(path: string, opts: RequestOptions = {}): Promise<Response> {
  const headers = new Headers({ Accept: 'application/json, application/problem+json' });
  const token = tokenStore.get();
  if (token && !opts.anonymous) headers.set('Authorization', `Bearer ${token}`);

  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    if (isMockMode()) {
      // Demo mock mode: an in-memory backend, loaded on demand so it never ships in the main bundle.
      const { mockFetch } = await import('./mock/server');
      res = await mockFetch(opts.method ?? 'GET', apiUrl(`${path}${buildQuery(opts.query)}`), { headers, body });
    } else {
      res = await fetch(apiUrl(`${path}${buildQuery(opts.query)}`), {
        method: opts.method ?? 'GET',
        headers,
        body,
        signal: opts.signal,
      });
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new NetworkError();
  }

  if (res.ok) return res;

  let problem: ProblemDetail = { status: res.status, title: res.statusText };
  const ct = res.headers.get('Content-Type') ?? '';
  if (ct.includes('json')) {
    try {
      problem = { status: res.status, ...((await res.json()) as ProblemDetail) };
    } catch {
      /* keep default */
    }
  }

  if (res.status === 401 && !opts.anonymous) {
    tokenStore.clear('unauthorized');
    onUnauthorized?.();
  }
  throw new ApiError(res.status, problem);
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await rawFetch(path, opts);
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('Content-Type') ?? '';
  if (!ct.includes('json')) return undefined as T;
  return (await res.json()) as T;
}

/** Fetch a binary resource with the bearer token (receipts, CSV). */
export async function requestBlob(
  path: string,
  opts: RequestOptions = {},
): Promise<{ blob: Blob; fileName: string | null }> {
  const res = await rawFetch(path, opts);
  const blob = await res.blob();
  return { blob, fileName: parseFileName(res.headers.get('Content-Disposition')) };
}

export function parseFileName(cd: string | null): string | null {
  if (!cd) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cd);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd);
  return plain?.[1]?.trim() ?? null;
}

// ---------------- page normalisation ----------------
interface PagedModelShape<T> {
  content?: T[];
  page?: { size?: number; number?: number; totalElements?: number; totalPages?: number } | number;
  number?: number;
  size?: number;
  totalElements?: number;
  totalPages?: number;
}

/** Accepts a Spring `Page`, a `PagedModel` (`{content, page:{…}}`) or a bare array. */
export function toPage<T>(raw: PagedModelShape<T> | T[] | null | undefined): Page<T> {
  if (!raw) return { content: [], page: 0, size: 0, totalElements: 0, totalPages: 0 };
  if (Array.isArray(raw)) {
    return { content: raw, page: 0, size: raw.length, totalElements: raw.length, totalPages: 1 };
  }
  const content = raw.content ?? [];
  if (raw.page && typeof raw.page === 'object') {
    return {
      content,
      page: raw.page.number ?? 0,
      size: raw.page.size ?? content.length,
      totalElements: raw.page.totalElements ?? content.length,
      totalPages: raw.page.totalPages ?? 1,
    };
  }
  const size = raw.size ?? content.length;
  const totalElements = raw.totalElements ?? content.length;
  return {
    content,
    page: raw.number ?? (typeof raw.page === 'number' ? raw.page : 0),
    size,
    totalElements,
    // Some endpoints (e.g. the auditor queue) omit totalPages; derive it so paging still works.
    totalPages: raw.totalPages ?? (size > 0 ? Math.max(1, Math.ceil(totalElements / size)) : 1),
  };
}

export async function requestPage<T>(path: string, opts: RequestOptions = {}): Promise<Page<T>> {
  const raw = await request<PagedModelShape<T> | T[]>(path, opts);
  return toPage(raw);
}

/** Accepts a bare array or a page and returns the items. */
export async function requestList<T>(path: string, opts: RequestOptions = {}): Promise<T[]> {
  const raw = await request<PagedModelShape<T> | T[]>(path, opts);
  if (Array.isArray(raw)) return raw;
  return raw?.content ?? [];
}
