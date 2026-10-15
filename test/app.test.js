const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');
const { addDays, todayIn } = require('../lib/store');

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lq-'));
  const dataFile = path.join(dir, 'db.json');
  const app = createApp({ dataFile, adminPassword: 'pw' });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = () => JSON.parse(fs.readFileSync(dataFile, 'utf8')).qrToken;
  const db = () => JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  return { base, token, db, close: () => server.close() };
}

const form = (data) => ({
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...(data.cookie ? { cookie: data.cookie } : {}) },
  body: new URLSearchParams(Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'cookie'))),
});

const cookieFrom = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');

test('date helpers', () => {
  assert.strictEqual(addDays('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(todayIn('Europe/London', new Date('2026-06-30T23:30:00Z')), '2026-07-01');
});

test('joining requires the QR token', async () => {
  const s = await setup();
  try {
    assert.strictEqual((await fetch(`${s.base}/join`)).status, 403);
    assert.strictEqual((await fetch(`${s.base}/join?t=wrong`)).status, 403);
    assert.strictEqual((await fetch(`${s.base}/join?t=${s.token()}`)).status, 200);
    const res = await fetch(`${s.base}/join`, form({ t: 'nope', name: 'A', house: 'B', day: 'today' }));
    assert.strictEqual(res.status, 403);
    assert.strictEqual(s.db().entries.length, 0);
  } finally { s.close(); }
});

test('student can join today or tomorrow, once per phone, and leave', async () => {
  const s = await setup();
  try {
    const res = await fetch(`${s.base}/join`, form({ t: s.token(), name: 'Alex Smith', house: 'Ashville 12', day: 'today' }));
    assert.strictEqual(res.status, 302);
    const cookie = cookieFrom(res);

    const dup = await fetch(`${s.base}/join`, form({ cookie, t: s.token(), name: 'Other', house: 'X', day: 'today' }));
    assert.strictEqual(dup.status, 400);

    const tmr = await fetch(`${s.base}/join`, form({ cookie, t: s.token(), name: 'Alex Smith', house: 'Ashville 12', day: 'tomorrow' }));
    assert.strictEqual(tmr.status, 302);

    const entries = s.db().entries;
    assert.strictEqual(entries.length, 2);
    assert.notStrictEqual(entries[0].date, entries[1].date);

    const home = await (await fetch(`${s.base}/`, { headers: { cookie } })).text();
    assert.match(home, /Alex Smith/);

    // someone else can't remove it
    await fetch(`${s.base}/leave/${entries[0].id}`, form({}));
    assert.strictEqual(s.db().entries.length, 2);
    await fetch(`${s.base}/leave/${entries[0].id}`, form({ cookie }));
    assert.strictEqual(s.db().entries.length, 1);
  } finally { s.close(); }
});

test('admin can log in, change status, remove and rotate QR', async () => {
  const s = await setup();
  try {
    await fetch(`${s.base}/join`, form({ t: s.token(), name: 'Sam', house: 'H', day: 'today' }));
    const id = s.db().entries[0].id;

    assert.strictEqual((await fetch(`${s.base}/admin`, { redirect: 'manual' })).headers.get('location'), '/admin/login');
    await fetch(`${s.base}/admin/remove/${id}`, form({}));
    assert.strictEqual(s.db().entries.length, 1, 'unauthenticated remove is ignored');

    assert.strictEqual((await fetch(`${s.base}/admin/login`, form({ password: 'bad' }))).status, 401);
    const login = await fetch(`${s.base}/admin/login`, form({ password: 'pw' }));
    const cookie = cookieFrom(login);

    const page = await (await fetch(`${s.base}/admin`, { headers: { cookie } })).text();
    assert.match(page, /<svg/);
    assert.match(page, /Sam/);

    await fetch(`${s.base}/admin/start/${id}`, form({ cookie }));
    assert.strictEqual(s.db().entries[0].status, 'washing');
    await fetch(`${s.base}/admin/done/${id}`, form({ cookie }));
    assert.strictEqual(s.db().entries[0].status, 'done');
    await fetch(`${s.base}/admin/remove/${id}`, form({ cookie }));
    assert.strictEqual(s.db().entries.length, 0);

    const old = s.token();
    await fetch(`${s.base}/admin/rotate-qr`, form({ cookie }));
    assert.notStrictEqual(s.token(), old);
    assert.strictEqual((await fetch(`${s.base}/join?t=${old}`)).status, 403);
  } finally { s.close(); }
});
