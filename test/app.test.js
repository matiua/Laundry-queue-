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
  const clock = { t: Date.parse('2026-10-15T09:00:00Z') };
  const pushes = [];
  const app = createApp({
    dataFile, adminPassword: 'pw', noShowMinutes: 10,
    now: () => new Date(clock.t),
    sendPush: async (sub, payload) => pushes.push({ endpoint: sub.endpoint, ...JSON.parse(payload) }),
  });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = () => JSON.parse(fs.readFileSync(dataFile, 'utf8')).qrToken;
  const db = () => JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  return { base, token, db, clock, pushes, close: () => server.close() };
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
    assert.match(home, /You&#39;re next!|You're next!/);

    // name and house are remembered for next time
    const again = await (await fetch(`${s.base}/join?t=${s.token()}`, { headers: { cookie: cookieFrom(res) } })).text();
    assert.match(again, /value="Alex Smith"/);

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

    // "call next" calls; "arrived" starts; "done" finishes and auto-calls the following person
    await fetch(`${s.base}/join`, form({ t: s.token(), name: 'Ann', house: 'H', day: 'today' }));
    await fetch(`${s.base}/join`, form({ t: s.token(), name: 'Ben', house: 'H', day: 'today' }));
    const date = s.db().entries[0].date;
    await fetch(`${s.base}/admin/next/${date}`, form({ cookie }));
    assert.deepStrictEqual(s.db().entries.map((e) => e.status), ['called', 'waiting']);
    await fetch(`${s.base}/admin/start/${s.db().entries[0].id}`, form({ cookie }));
    await fetch(`${s.base}/admin/next/${date}`, form({ cookie }));
    assert.deepStrictEqual(s.db().entries.map((e) => e.status), ['washing', 'waiting'], 'no free machine, nobody called');
    await fetch(`${s.base}/admin/done/${s.db().entries[0].id}`, form({ cookie }));
    assert.deepStrictEqual(s.db().entries.map((e) => [e.name, e.status]), [['Ann', 'done'], ['Ben', 'called']]);

    const old = s.token();
    await fetch(`${s.base}/admin/rotate-qr`, form({ cookie }));
    assert.notStrictEqual(s.token(), old);
    assert.strictEqual((await fetch(`${s.base}/join?t=${old}`)).status, 403);
  } finally { s.close(); }
});

async function joinAs(s, name) {
  const res = await fetch(`${s.base}/join`, form({ t: s.token(), name, house: 'H', day: 'today' }));
  const cookie = cookieFrom(res);
  const sub = { endpoint: `https://push.example/${name}`, keys: { p256dh: 'k', auth: 'a' } };
  const r = await fetch(`${s.base}/api/subscribe`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ subscription: sub }),
  });
  assert.strictEqual(r.status, 200);
  return cookie;
}

async function adminCookie(s) {
  return cookieFrom(await fetch(`${s.base}/admin/login`, form({ password: 'pw' })));
}

const tick = () => new Promise((r) => setTimeout(r, 20));
const statuses = (s) => s.db().entries.map((e) => `${e.name}:${e.status}`);

test('calling next sends a push; no-shows go to the back, then off the list', async () => {
  const s = await setup();
  try {
    const annCookie = await joinAs(s, 'Ann');
    await joinAs(s, 'Ben');
    const admin = await adminCookie(s);
    const date = s.db().entries[0].date;

    await fetch(`${s.base}/admin/next/${date}`, form({ cookie: admin }));
    await tick();
    assert.deepStrictEqual(statuses(s), ['Ann:called', 'Ben:waiting']);
    assert.strictEqual(s.pushes.at(-1).endpoint, 'https://push.example/Ann');
    assert.match(s.pushes.at(-1).title, /your turn/);

    const home = await (await fetch(`${s.base}/`, { headers: { cookie: annCookie } })).text();
    assert.match(home, /It&#39;s your turn!|It's your turn!/);
    assert.match(home, /data-deadline/);

    // staff: not here → Ann to the back, Ben called
    await fetch(`${s.base}/admin/skip/${s.db().entries[0].id}`, form({ cookie: admin }));
    await tick();
    const ann = s.db().entries.find((e) => e.name === 'Ann');
    assert.strictEqual(ann.status, 'waiting');
    assert.strictEqual(ann.misses, 1);
    assert.strictEqual(s.db().entries.find((e) => e.name === 'Ben').status, 'called');
    assert.ok(s.pushes.some((p) => p.endpoint.endsWith('Ann') && /missed/.test(p.title)));
    assert.ok(s.pushes.some((p) => p.endpoint.endsWith('Ben') && /your turn/.test(p.title)));

    // Ben arrives and finishes; Ann is called again automatically and times out → removed (second miss)
    const benId = s.db().entries.find((e) => e.name === 'Ben').id;
    await fetch(`${s.base}/admin/start/${benId}`, form({ cookie: admin }));
    await fetch(`${s.base}/admin/done/${benId}`, form({ cookie: admin }));
    assert.strictEqual(s.db().entries.find((e) => e.name === 'Ann').status, 'called');
    s.clock.t += 9 * 60000;
    await fetch(`${s.base}/api/version`);
    assert.strictEqual(s.db().entries.find((e) => e.name === 'Ann').status, 'called', 'still within 10 minutes');
    s.clock.t += 61000;
    await fetch(`${s.base}/api/version`);
    await tick();
    assert.deepStrictEqual(statuses(s), ['Ben:done']);
    assert.ok(s.pushes.some((p) => p.endpoint.endsWith('Ann') && /Removed/.test(p.title)));
  } finally { s.close(); }
});

test('auto-skip on timeout calls the next person', async () => {
  const s = await setup();
  try {
    await joinAs(s, 'Ann');
    await joinAs(s, 'Ben');
    const admin = await adminCookie(s);
    await fetch(`${s.base}/admin/next/${s.db().entries[0].date}`, form({ cookie: admin }));
    s.clock.t += 10 * 60000;
    await fetch(`${s.base}/admin`, { headers: { cookie: admin } });
    assert.deepStrictEqual(statuses(s).sort(), ['Ann:waiting', 'Ben:called']);
    assert.strictEqual(s.db().entries.find((e) => e.name === 'Ann').misses, 1);
  } finally { s.close(); }
});

test('a called student who leaves hands the turn on', async () => {
  const s = await setup();
  try {
    const annCookie = await joinAs(s, 'Ann');
    await joinAs(s, 'Ben');
    const admin = await adminCookie(s);
    await fetch(`${s.base}/admin/next/${s.db().entries[0].date}`, form({ cookie: admin }));
    await fetch(`${s.base}/leave/${s.db().entries[0].id}`, form({ cookie: annCookie }));
    assert.deepStrictEqual(statuses(s), ['Ben:called']);
  } finally { s.close(); }
});

test('subscribe rejects bad input', async () => {
  const s = await setup();
  try {
    const post = (body, cookie = 'lq_device=' + 'a'.repeat(32)) => fetch(`${s.base}/api/subscribe`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
    });
    assert.strictEqual((await post({})).status, 400);
    assert.strictEqual((await post({ subscription: { endpoint: 'http://x', keys: { p256dh: 'a', auth: 'b' } } })).status, 400);
    assert.strictEqual((await post({ subscription: { endpoint: 'https://x', keys: { p256dh: 'a', auth: 'b' } } }, '')).status, 400);
    assert.strictEqual((await post({ subscription: { endpoint: 'https://x', keys: { p256dh: 'a', auth: 'b' } } })).status, 200);
  } finally { s.close(); }
});

const { estimate } = require('../lib/turns');

async function saveSettings(s, cookie, changes) {
  const body = { washMinutes: 45, noShowMinutes: 10, dailyLimit: 0, ...changes };
  return fetch(`${s.base}/admin/settings`, form({ cookie, ...body }));
}

test('wait estimate: each person ahead takes one wash', () => {
  const at = 1_000_000_000;
  const list = [
    { id: 'a', status: 'washing', startedAt: at - 15 * 60000 },
    { id: 'b', status: 'waiting' },
    { id: 'c', status: 'waiting' },
  ];
  const est = estimate(list, { washMinutes: 45 }, at);
  assert.strictEqual(est.washLeft, 30 * 60000);
  assert.strictEqual(est.startIn.get('b'), 30 * 60000);
  assert.strictEqual(est.startIn.get('c'), 75 * 60000);
});

test('settings are validated', async () => {
  const s = await setup();
  try {
    const admin = await adminCookie(s);
    assert.strictEqual((await saveSettings(s, admin, { washMinutes: 5 })).status, 400);
    assert.strictEqual((await saveSettings(s, admin, { noShowMinutes: 'abc' })).status, 400);
    assert.strictEqual((await fetch(`${s.base}/admin/settings`, form({ washMinutes: 60 }))).status, 302, 'needs login');
    assert.strictEqual(s.db().settings.washMinutes, 45);
    assert.strictEqual((await saveSettings(s, admin, { washMinutes: 60, dailyLimit: 20 })).status, 302);
    assert.deepStrictEqual(s.db().settings, { washMinutes: 60, noShowMinutes: 10, dailyLimit: 20 });
  } finally { s.close(); }
});

test('daily limit makes a day full', async () => {
  const s = await setup();
  try {
    const join = (name, day) => fetch(`${s.base}/join`, form({ t: s.token(), name, house: 'H', day }));
    const admin = await adminCookie(s);
    await saveSettings(s, admin, { dailyLimit: 1 });
    assert.strictEqual((await join('Ben', 'today')).status, 302);
    const full = await join('Cat', 'today');
    assert.strictEqual(full.status, 400);
    assert.match(await full.text(), /full/);
    assert.strictEqual((await join('Cat', 'tomorrow')).status, 302, 'tomorrow has its own limit');
  } finally { s.close(); }
});

test('home page shows an estimated wait', async () => {
  const s = await setup();
  try {
    await joinAs(s, 'Ann');
    const benCookie = await joinAs(s, 'Ben');
    const admin = await adminCookie(s);
    await fetch(`${s.base}/admin/next/${s.db().entries[0].date}`, form({ cookie: admin }));
    await fetch(`${s.base}/admin/start/${s.db().entries[0].id}`, form({ cookie: admin }));
    s.clock.t += 15 * 60000;
    const home = await (await fetch(`${s.base}/`, { headers: { cookie: benCookie } })).text();
    assert.match(home, /You&#39;re next!|You're next!/);
    assert.match(home, /about 30 min/);
    assert.match(home, /30 min left/);
  } finally { s.close(); }
});

test('laundry room screen needs its secret link', async () => {
  const s = await setup();
  try {
    assert.strictEqual((await fetch(`${s.base}/display`)).status, 403);
    const key = s.db().displayKey;
    const page = await fetch(`${s.base}/display?k=${key}`);
    assert.strictEqual(page.status, 200);
    assert.match(await page.text(), /<svg/);
    const admin = await adminCookie(s);
    await fetch(`${s.base}/admin/rotate-qr`, form({ cookie: admin }));
    assert.strictEqual((await fetch(`${s.base}/display?k=${key}`)).status, 403, 'new code replaces the screen link too');
  } finally { s.close(); }
});

test('a student can say they are done, which frees the machine for the next person', async () => {
  const s = await setup();
  try {
    const annCookie = await joinAs(s, 'Ann');
    const benCookie = await joinAs(s, 'Ben');
    const admin = await adminCookie(s);
    await fetch(`${s.base}/admin/next/${s.db().entries[0].date}`, form({ cookie: admin }));
    const annId = s.db().entries[0].id;
    await fetch(`${s.base}/admin/start/${annId}`, form({ cookie: admin }));

    const page = await (await fetch(`${s.base}/`, { headers: { cookie: annCookie } })).text();
    assert.match(page, /I&#39;m done|I'm done/);

    // someone else can't finish Ann's wash
    await fetch(`${s.base}/finish/${annId}`, form({ cookie: benCookie }));
    assert.deepStrictEqual(statuses(s), ['Ann:washing', 'Ben:waiting']);

    const before = s.pushes.length;
    const res = await fetch(`${s.base}/finish/${annId}`, form({ cookie: annCookie }));
    assert.strictEqual(res.headers.get('location'), '/?m=finished');
    await tick();
    assert.deepStrictEqual(statuses(s), ['Ann:done', 'Ben:called']);
    const sent = s.pushes.slice(before);
    assert.ok(sent.some((p) => p.endpoint.endsWith('Ben') && /your turn/.test(p.title)), 'Ben is told it is his turn');
    assert.ok(!sent.some((p) => p.endpoint.endsWith('Ann')), 'Ann is not told to collect laundry she already took');
  } finally { s.close(); }
});
