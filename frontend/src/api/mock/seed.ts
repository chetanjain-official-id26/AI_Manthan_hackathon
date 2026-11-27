import type { Category, CityTier, Role } from '../types';
import { cityTierFor } from '@/utils/cities';
import { DAY, HOUR, MockDb, digestHex, istDate, mulberry32, normVendor, receiptSvg, type MClaim, type MUser } from './db';

/** Deterministic synthetic organisation and ~4 months of claim history, generated through the real engine. */
export function seed(now = Date.now()): MockDb {
  const db = new MockDb();
  const rnd = mulberry32(42);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  const between = (a: number, b: number) => a + rnd() * (b - a);
  const money = (a: number, b: number, step = 10) => (Math.round(between(a, b) / step) * step).toFixed(2);

  // ---------- people ----------
  const mk = (id: number, name: string, department: string, roles: Role[], managerId: number | null): MUser => ({
    id,
    empCode: `EMP${String(id).padStart(4, '0')}`,
    name,
    email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.test`,
    department,
    roles,
    managerId,
    bankAccountMasked: `XXXXXX${String(1000 + ((id * 7919) % 9000)).slice(-4)}`,
    ifsc: `SYNB000${String(100 + ((id * 31) % 900))}`,
  });
  db.users.push(mk(1, 'Priya Nair', 'Finance', ['EMPLOYEE', 'FINANCE_HEAD'], null));
  db.users.push(mk(2, 'Kabir Shah', 'Finance', ['EMPLOYEE', 'AUDITOR'], 1));
  db.users.push(mk(3, 'Farah Khan', 'Finance', ['EMPLOYEE', 'AUDITOR'], 1));
  const managers: [number, string, string][] = [
    [10, 'Meera Iyer', 'Sales'],
    [11, 'Arjun Mehta', 'Engineering'],
    [12, 'Sana Qureshi', 'Marketing'],
    [13, 'Vikram Rao', 'Operations'],
    [14, 'Neha Kulkarni', 'People'],
  ];
  for (const [id, name, dept] of managers) db.users.push(mk(id, name, dept, ['EMPLOYEE', 'MANAGER'], 1));
  const staff: [string, number][] = [
    ['Ananya Rao', 10], ['Rohit Verma', 10], ['Karthik Reddy', 10], ['Ishita Bose', 10],
    ['Aditya Singh', 11], ['Pooja Menon', 11], ['Rahul Desai', 11], ['Zoya Ali', 11],
    ['Nikhil Joshi', 12], ['Tanvi Shah', 12], ['Siddharth Jain', 12],
    ['Divya Pillai', 13], ['Manish Gupta', 13], ['Lakshmi Narayan', 13],
    ['Harsh Vardhan', 14], ['Ritu Malhotra', 14],
    ['Gaurav Sethi', 1], ['Aisha Kapoor', 1],
  ];
  staff.forEach(([name, mgr], i) => {
    const dept = mgr === 1 ? 'Finance' : (managers.find((m) => m[0] === mgr)?.[2] ?? 'Sales');
    db.users.push(mk(100 + i, name, dept, ['EMPLOYEE'], mgr));
  });
  const fh = db.user(1) as MUser;
  const auditors = db.users.filter((u) => u.roles.includes('AUDITOR'));
  const employees = db.users.filter((u) => u.roles.length === 1);
  const claimants = [...employees, ...employees, ...db.users.filter((u) => u.roles.includes('MANAGER'))];

  // ---------- policy rules (v1 180 days ago; tier-1 hotel revised 40 days ago) ----------
  const ruleStart = now - 180 * DAY;
  const seedRules: [string, Category | null, CityTier | null, string | null, 'PER_DAY' | 'PER_NIGHT' | 'PER_TRIP' | 'PER_LINE' | 'NONE', 'ROUTE' | 'AUTO_REJECT', 'OVER_LIMIT' | 'RECEIPT' | 'DUPLICATE' | 'WEEKEND' | 'STALE'][] = [
    ['MEAL_DAILY_LIMIT', 'MEAL', null, '1500.00', 'PER_DAY', 'ROUTE', 'OVER_LIMIT'],
    ['HOTEL_NIGHTLY_LIMIT', 'HOTEL', 'TIER_1', '5500.00', 'PER_NIGHT', 'ROUTE', 'OVER_LIMIT'],
    ['HOTEL_NIGHTLY_LIMIT', 'HOTEL', 'OTHER', '4000.00', 'PER_NIGHT', 'ROUTE', 'OVER_LIMIT'],
    ['CAB_TRIP_LIMIT', 'CAB', null, '2000.00', 'PER_TRIP', 'ROUTE', 'OVER_LIMIT'],
    ['RECEIPT_REQUIRED', null, null, '500.00', 'PER_LINE', 'AUTO_REJECT', 'RECEIPT'],
    ['DUPLICATE_VENDOR_AMOUNT_DATE', null, null, null, 'NONE', 'ROUTE', 'DUPLICATE'],
    ['DUPLICATE_RECEIPT_HASH', null, null, null, 'NONE', 'ROUTE', 'DUPLICATE'],
    ['WEEKEND_SPEND', null, null, null, 'NONE', 'ROUTE', 'WEEKEND'],
    ['STALE_EXPENSE', null, null, null, 'NONE', 'ROUTE', 'STALE'],
  ];
  for (const [ruleCode, category, cityTier, limitAmount, unit, action, flag] of seedRules) {
    db.addRuleVersion(
      { ruleCode, category, cityTier, limitAmount, unit, action, flag, params: null, active: true, effectiveFrom: new Date(ruleStart).toISOString(), createdById: null, createdByName: 'Seed', reason: 'Initial policy' },
      ruleStart,
    );
  }
  const hotelRevision = now - 40 * DAY;
  db.addRuleVersion(
    { ruleCode: 'HOTEL_NIGHTLY_LIMIT', category: 'HOTEL', cityTier: 'TIER_1', limitAmount: '6000.00', unit: 'PER_NIGHT', action: 'ROUTE', flag: 'OVER_LIMIT', params: null, active: true, effectiveFrom: new Date(hotelRevision).toISOString(), createdById: fh.id, createdByName: fh.name, reason: 'Tier-1 hotel rates revised for 2026' },
    hotelRevision,
  );

  // ---------- helpers ----------
  const vendors: Record<Category, string[]> = {
    MEAL: ['Cafe Mocha', 'Saravana Bhavan', 'Barbeque Nation', 'Haldiram’s', 'Social', 'Mainland China'],
    HOTEL: ['Taj Hotel', 'Lemon Tree', 'Ginger Hotel', 'ITC Grand', 'Novotel', 'FabHotel Prime'],
    CAB: ['Ola', 'Uber', 'Meru Cabs', 'BluSmart'],
    OTHER: ['Conference Pass', 'Dell Store', 'Office Depot', 'Udemy Business', 'Airtel', 'IndiGo'],
  };
  const cities = ['Mumbai', 'Delhi', 'Bengaluru', 'Pune', 'Hyderabad', 'Chennai', 'Jaipur', 'Kochi', 'Indore', 'Lucknow'];
  const titles = ['Client visit', 'Sales offsite', 'Customer onboarding', 'Team travel', 'Vendor audit', 'Conference', 'Training', 'Site inspection'];

  interface Spec {
    category: Category;
    amount: string;
    date: string;
    vendor?: string;
    city?: string;
    nights?: number | null;
    receipt?: boolean | string;
  }

  const addLines = (c: MClaim, specs: Spec[], at: number) => {
    for (const s of specs) {
      const city = s.city ?? pick(cities);
      const vendor = s.vendor ?? pick(vendors[s.category]);
      const line = db.addLine(
        c,
        { category: s.category, amount: s.amount, expenseDate: s.date, vendor, city, cityTier: cityTierFor(city), nights: s.category === 'HOTEL' ? (s.nights ?? 1) : null, description: `${vendor} · ${city}` },
        at,
      );
      const needs = Number(s.amount) > 500;
      const attach = typeof s.receipt === 'string' ? true : (s.receipt ?? (needs ? rnd() < 0.94 : rnd() < 0.4));
      if (attach) {
        const svg = typeof s.receipt === 'string' ? s.receipt : receiptSvg(vendor, s.amount, s.date, s.category, `INV-${line.id}-${Math.floor(rnd() * 1e6)}`);
        db.attachReceipt(line, new Blob([svg], { type: 'image/svg+xml' }), `${normVendor(vendor).replace(/ /g, '-')}-${s.date}.svg`, digestHex(svg), at);
      }
    }
  };

  const dateFrom = (daysAgo: number, plus = 0) => istDate(now - (daysAgo - plus) * DAY);

  const specsFor = (kind: number, daysAgo: number): Spec[] => {
    const d = (k: number) => dateFrom(daysAgo, Math.min(k, daysAgo - 1));
    if (kind < 0.4) {
      const n = 1 + Math.floor(rnd() * 3);
      return Array.from({ length: n }, (_, i) => (rnd() < 0.6 ? { category: 'MEAL' as const, amount: money(180, 1700), date: d(i) } : { category: 'CAB' as const, amount: money(120, 2300), date: d(i) }));
    }
    if (kind < 0.75) {
      const city = pick(cities);
      const nights = 1 + Math.floor(rnd() * 3);
      const perNight = between(2800, cityTierFor(city) === 'TIER_1' ? 7200 : 5000);
      return [
        { category: 'HOTEL', amount: (Math.round((perNight * nights) / 10) * 10).toFixed(2), date: d(0), city, nights },
        { category: 'MEAL', amount: money(400, 1600), date: d(0), city },
        { category: 'MEAL', amount: money(300, 1400), date: d(1), city },
        { category: 'CAB', amount: money(300, 2600), date: d(1), city },
      ];
    }
    if (kind < 0.9) return [{ category: 'OTHER', amount: money(26000, 92000, 50), date: d(0) }, { category: 'CAB', amount: money(200, 900), date: d(0) }];
    return [{ category: 'OTHER', amount: money(101000, 165000, 100), date: d(0) }];
  };

  /** Moves a submitted claim along its chain, the way the approvers would have. */
  const progress = (c: MClaim, ageDays: number) => {
    if (c.sampleAudit && ageDays < 40) return; // keep the 10% sample visible in the auditor queue
    for (let guard = 0; guard < 4 && c.status.startsWith('PENDING_'); guard += 1) {
      const step = db.currentStep(c.id);
      if (!step || step.activatedAt === null) return;
      // Older history is fully processed; the last month keeps a realistic backlog.
      const willAct = ageDays > 30 ? true : ageDays > 6 ? rnd() < 0.85 : rnd() < 0.4;
      if (!willAct) return;
      const at = Math.min(step.activatedAt + between(2, 40) * HOUR, now - HOUR);
      if (at <= step.activatedAt) return;
      const actor = step.assigneeId ? db.user(step.assigneeId) : step.level === 'AUDITOR' ? pick(auditors) : fh;
      if (!actor || actor.id === c.employeeId) return;
      const roll = rnd();
      if (roll < 0.86) db.act(c, actor, 'APPROVE', undefined, null, at);
      else if (roll < 0.94) db.act(c, actor, 'SEND_BACK', undefined, pick(['Please attach the hotel invoice, not the booking confirmation.', 'Split the client dinner from the team meal, please.', 'Which client was this for? Add it to the description.']), at);
      else db.act(c, actor, 'REJECT', undefined, pick(['Personal expense, not reimbursable.', 'Duplicate of a claim already paid.']), at);
    }
  };

  const fileClaim = (owner: MUser, daysAgo: number, specs: Spec[], title?: string, opts: { submit?: boolean; progress?: boolean } = {}) => {
    const created = now - daysAgo * DAY + 3 * HOUR;
    const c = db.createClaim(owner, `${title ?? pick(titles)} ${pick(cities)}`, created);
    addLines(c, specs, created + 10 * 60_000);
    if (opts.submit === false) return c;
    const submitAt = Math.min(created + between(4, 30) * HOUR, now - 2 * HOUR);
    db.submit(c, submitAt);
    if (opts.progress !== false) progress(c, daysAgo);
    return c;
  };

  // ---------- history ----------
  for (let i = 0; i < 110; i += 1) {
    const owner = pick(claimants);
    const daysAgo = 1 + Math.floor(rnd() * 118);
    fileClaim(owner, daysAgo, specsFor(rnd(), daysAgo));
  }

  // Planted duplicates: same receipt file claimed by two employees (DUPLICATE_RECEIPT_HASH), then manager-approved → auditor queue.
  for (let i = 0; i < 4; i += 1) {
    const a = employees[(i * 3) % employees.length] as MUser;
    const b = employees[(i * 3 + 5) % employees.length] as MUser;
    const daysAgo = 4 + i * 3;
    const date = dateFrom(daysAgo);
    const amount = money(26500, 48000, 50);
    const svg = receiptSvg('Conference Pass', amount, date, 'OTHER', `INV-DUP-${i}`);
    fileClaim(a, daysAgo + 1, [{ category: 'OTHER', amount, date, vendor: 'Conference Pass', receipt: svg }], 'Industry summit', { progress: false });
    const dup = fileClaim(b, daysAgo, [{ category: 'OTHER', amount, date, vendor: 'Conference Pass', receipt: svg }], 'Industry summit', { progress: false });
    const step = db.currentStep(dup.id);
    const mgr = db.user(step?.assigneeId);
    if (step?.activatedAt && mgr && i < 3) db.act(dup, mgr, 'APPROVE', undefined, null, step.activatedAt + 5 * HOUR);
  }
  // Planted vendor + amount + date duplicate by the same employee.
  {
    const e = employees[2] as MUser;
    const date = dateFrom(9);
    fileClaim(e, 10, [{ category: 'HOTEL', amount: '4500.00', date, vendor: 'Taj Hotel', city: 'Pune', nights: 1 }], 'Customer onboarding', { progress: false });
    fileClaim(e, 8, [{ category: 'HOTEL', amount: '4500.00', date, vendor: 'taj  hotel.', city: 'Pune', nights: 1 }], 'Customer onboarding', { progress: false });
  }
  // Planted split: two claims just under 25k within a week.
  {
    const e = employees[6] as MUser;
    fileClaim(e, 5, [{ category: 'OTHER', amount: '19800.00', date: dateFrom(5) }], 'Equipment purchase', { progress: false });
    const second = fileClaim(e, 3, [{ category: 'OTHER', amount: '19500.00', date: dateFrom(4) }], 'Equipment purchase', { progress: false });
    const st = db.currentStep(second.id);
    const mgr = db.user(st?.assigneeId);
    if (st?.activatedAt && mgr) db.act(second, mgr, 'APPROVE', undefined, null, st.activatedAt + 4 * HOUR);
  }

  // The demo employee (Ananya Rao): one of every state worth showing.
  const ananya = employees[0] as MUser;
  const meera = db.user(ananya.managerId) as MUser;
  {
    const sent = fileClaim(ananya, 3, [
      { category: 'HOTEL', amount: '9000.00', date: dateFrom(3), city: 'Mumbai', nights: 2, vendor: 'Lemon Tree' },
      { category: 'MEAL', amount: '1200.00', date: dateFrom(3), city: 'Mumbai' },
    ], 'Client visit', { progress: false });
    const st = db.currentStep(sent.id);
    if (st?.activatedAt) db.act(sent, meera, 'SEND_BACK', undefined, 'Please add the client name and split the dinner from the team lunch.', st.activatedAt + 6 * HOUR);
    fileClaim(ananya, 1, [{ category: 'MEAL', amount: '1200.00', date: dateFrom(1), city: 'Pune', receipt: true }, { category: 'CAB', amount: '650.00', date: dateFrom(1), city: 'Pune', receipt: false }], 'Client visit Pune', { submit: false });
    fileClaim(ananya, 2, [{ category: 'OTHER', amount: '18000.00', date: dateFrom(2), vendor: 'Dell Store', receipt: true }], 'Laptop accessories', { progress: false });
  }
  // A few drafts for others.
  for (let i = 0; i < 5; i += 1) fileClaim(employees[(i * 4 + 1) % employees.length] as MUser, 1 + i, specsFor(0.2, 1 + i), undefined, { submit: false });
  // Old pending claims so SLA badges go amber/red.
  for (let i = 0; i < 4; i += 1) {
    const owner = employees[(i * 5 + 3) % employees.length] as MUser;
    const c = fileClaim(owner, 2 + i, [{ category: 'OTHER', amount: money(6000, 23000), date: dateFrom(2 + i) }], undefined, { progress: false });
    void c;
  }
  // Big claims waiting for the finance head.
  for (let i = 0; i < 2; i += 1) {
    const owner = employees[(i * 7 + 2) % employees.length] as MUser;
    const c = fileClaim(owner, 3 + i, [{ category: 'OTHER', amount: money(110000, 150000, 100), date: dateFrom(3 + i) }], 'Annual partner conference', { progress: false });
    for (let k = 0; k < 2; k += 1) {
      const st = db.currentStep(c.id);
      const actor = st?.assigneeId ? db.user(st.assigneeId) : auditors[0];
      if (st?.activatedAt && actor) db.act(c, actor, 'APPROVE', undefined, null, st.activatedAt + 8 * HOUR);
    }
  }

  // ---------- payouts: one paid batch from older approvals, one exported batch waiting ----------
  const approvedOld = db.claims.filter((c) => c.status === 'APPROVED' && c.approvedAt !== null && c.approvedAt < now - 25 * DAY);
  const paidSet = approvedOld.slice(0, Math.ceil(approvedOld.length * 0.6));
  if (paidSet.length) {
    const t = now - 20 * DAY;
    const b = db.createBatch(fh, paidSet.map((c) => c.id), t);
    db.exportBatch(fh, b, t + HOUR);
    db.markPaid(fh, b, undefined, t + 30 * HOUR);
  }
  const approvedMid = db.claims.filter((c) => c.status === 'APPROVED' && c.approvedAt !== null && c.approvedAt < now - 10 * DAY).slice(0, 6);
  if (approvedMid.length) {
    const t = now - 2 * DAY;
    const b = db.createBatch(fh, approvedMid.map((c) => c.id), t);
    db.exportBatch(fh, b, t + 2 * HOUR);
  }

  // ---------- delegation: Operations manager on leave, Sales manager covers ----------
  db.delegations.push({ id: db.nextId('delegation'), delegatorId: 13, delegateId: 10, fromDate: istDate(now - DAY), toDate: istDate(now + 5 * DAY), reason: 'Annual leave', revoked: false, createdAt: now - 2 * DAY });
  db.delegations.push({ id: db.nextId('delegation'), delegatorId: 11, delegateId: 12, fromDate: istDate(now - 30 * DAY), toDate: istDate(now - 25 * DAY), reason: 'Conference travel', revoked: false, createdAt: now - 31 * DAY });

  return db;
}
