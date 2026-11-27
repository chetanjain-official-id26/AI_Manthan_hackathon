import { randomBytes } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** Minimal shapes of the API used for test setup (mirrors frontend/src/api/types.ts). */
export interface User {
  id: number;
  name: string;
  roles: string[];
  managerId?: number | null;
  department?: string;
}
export interface Claim {
  id: number;
  claimNo: string;
  status: string;
  version: number;
  totalAmount: number | string;
  lines: { id: number }[];
}
export type Category = 'MEAL' | 'HOTEL' | 'CAB' | 'OTHER';
export interface LineSpec {
  category: Category;
  amount: string;
  expenseDate?: string;
  vendor?: string;
  city?: string;
  cityTier?: 'TIER_1' | 'OTHER';
  nights?: number | null;
  description?: string;
  /** true = upload a unique receipt; Buffer = upload these exact bytes (duplicate tests). */
  receipt?: boolean | Buffer;
}

const RANK: Record<string, number> = { EMPLOYEE: 0, MANAGER: 1, AUDITOR: 2, FINANCE_HEAD: 3 };
export const primaryRole = (u: User) => [...u.roles].sort((a, b) => (RANK[b] ?? 0) - (RANK[a] ?? 0))[0] ?? 'EMPLOYEE';

// ---------- dates (IST) ----------
const istDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
/** An IST weekday date `back` working days ago (avoids WEEKEND flags). */
export function weekday(back = 1): string {
  const d = new Date();
  let left = back;
  while (true) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = new Date(`${istDate(d)}T12:00:00+05:30`).getUTCDay();
    if (dow !== 0 && dow !== 6 && --left <= 0) return istDate(d);
  }
}

// ---------- receipts ----------
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
/** A valid PNG (correct magic bytes) with random trailing bytes, so every receipt has a unique SHA-256. */
export const uniquePng = (): Buffer => Buffer.concat([PNG_1PX, randomBytes(16)]);

/** A unique amount like 30000.37, used to isolate this run's claims in filtered lists. */
export function uniqueAmount(base: number): string {
  return `${base + Math.floor(Math.random() * 900)}.${String(Math.floor(Math.random() * 99) + 1).padStart(2, '0')}`;
}

// ---------- API client ----------
export class Api {
  constructor(
    private readonly request: APIRequestContext,
    readonly token: string,
    readonly user: User,
  ) {}

  private headers() {
    return { Authorization: `Bearer ${this.token}` };
  }

  async json<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, data?: unknown): Promise<T> {
    const res = await this.request.fetch(`/api${path}`, { method, headers: this.headers(), data });
    expect(res.ok(), `${method} ${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  getClaim(id: number) {
    return this.json<Claim>('GET', `/claims/${id}`);
  }

  async createClaim(title: string, lines: LineSpec[]): Promise<Claim> {
    const claim = await this.json<Claim>('POST', '/claims', { title });
    let i = 0;
    for (const l of lines) {
      i += 1;
      const line = await this.json<{ id: number }>('POST', `/claims/${claim.id}/lines`, {
        category: l.category,
        amount: l.amount,
        expenseDate: l.expenseDate ?? weekday(i),
        vendor: l.vendor ?? `E2E Vendor ${randomBytes(3).toString('hex')}`,
        city: l.city ?? 'Pune',
        cityTier: l.cityTier ?? 'TIER_1',
        nights: l.category === 'HOTEL' ? (l.nights ?? 1) : null,
        description: l.description ?? 'E2E',
      });
      if (l.receipt) {
        const bytes = Buffer.isBuffer(l.receipt) ? l.receipt : uniquePng();
        const res = await this.request.post(`/api/claims/${claim.id}/lines/${line.id}/receipt`, {
          headers: this.headers(),
          multipart: { file: { name: 'receipt.png', mimeType: 'image/png', buffer: bytes } },
        });
        expect(res.ok(), `receipt upload → ${res.status()}`).toBeTruthy();
      }
    }
    return this.getClaim(claim.id);
  }

  async submit(id: number): Promise<Claim> {
    const c = await this.getClaim(id);
    return this.json<Claim>('POST', `/claims/${id}/submit`, { version: c.version });
  }

  async createAndSubmit(title: string, lines: LineSpec[]): Promise<Claim> {
    const c = await this.createClaim(title, lines);
    return this.submit(c.id);
  }

  async approve(id: number): Promise<Claim> {
    const c = await this.getClaim(id);
    return this.json<Claim>('POST', `/claims/${id}/approve`, { version: c.version });
  }
}

export async function users(request: APIRequestContext): Promise<User[]> {
  const res = await request.get('/api/auth/demo-users');
  expect(res.ok(), 'GET /api/auth/demo-users — is the stack running and seeded?').toBeTruthy();
  const body = (await res.json()) as User[] | { content: User[] };
  return Array.isArray(body) ? body : body.content;
}

export async function loginApi(request: APIRequestContext, user: User): Promise<Api> {
  const res = await request.post('/api/auth/demo-login', { data: { employeeId: user.id } });
  expect(res.ok(), `demo-login ${user.id} → ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { token: string };
  return new Api(request, body.token, user);
}

/** Cast of seeded users for a test: an employee with their manager, a colleague, an auditor, the finance head. */
export interface Cast {
  employee: User;
  manager: User;
  colleague: User;
  otherEmployee: User;
  auditor: User;
  financeHead: User;
}

export async function cast(request: APIRequestContext): Promise<Cast> {
  const all = await users(request);
  const byId = new Map(all.map((u) => [u.id, u]));
  const plain = all.filter((u) => primaryRole(u) === 'EMPLOYEE');
  const employee = plain.find((u) => u.managerId && primaryRole(byId.get(u.managerId) ?? u) === 'MANAGER');
  if (!employee?.managerId) throw new Error('Seed has no employee with a MANAGER');
  const manager = byId.get(employee.managerId) as User;
  const colleague = plain.find((u) => u.id !== employee.id && u.managerId !== manager.id) ?? plain.find((u) => u.id !== employee.id);
  const otherEmployee = plain.find((u) => u.id !== employee.id && u.id !== colleague?.id);
  const auditor = all.find((u) => primaryRole(u) === 'AUDITOR');
  const financeHead = all.find((u) => primaryRole(u) === 'FINANCE_HEAD');
  if (!colleague || !otherEmployee || !auditor || !financeHead) throw new Error('Seed is missing personas');
  return { employee, manager, colleague, otherEmployee, auditor, financeHead };
}

// ---------- UI helpers ----------
/** Signs in through the real login screen (S1). */
export async function signInUI(page: Page, user: User): Promise<void> {
  await page.goto('/login');
  await page.getByTestId(`login-tab-${primaryRole(user)}`).click();
  await page.getByTestId('login-search').fill(user.name);
  await page.getByTestId(`login-user-${user.id}`).click();
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('home-greeting')).toBeVisible();
}

/** Fast sign-in: puts an API token into this tab's sessionStorage before the app boots. */
export async function signInAs(page: Page, api: Api): Promise<void> {
  const exp = String(Date.now() + 55 * 60_000);
  await page.addInitScript(
    ([token, expiry]) => {
      if (!sessionStorage.getItem('ef.token')) {
        sessionStorage.setItem('ef.token', token);
        sessionStorage.setItem('ef.tokenExpiresAt', expiry);
      }
    },
    [api.token, exp] as const,
  );
}

export const isNarrow = (page: Page, breakpoint = 1024) => (page.viewportSize()?.width ?? 1366) < breakpoint;

/** Approve / submit buttons have mobile twins with an `m-` prefix. */
export const tid = (page: Page, id: string, breakpoint = 1024) => page.getByTestId(isNarrow(page, breakpoint) ? `m-${id}` : id);
