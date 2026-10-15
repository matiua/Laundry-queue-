const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const webpush = require('web-push');
const { Store, todayIn, addDays } = require('./lib/store');
const views = require('./lib/views');
const { createTurns, estimate } = require('./lib/turns');

const TIME_ZONE = 'Europe/London';
const ADMIN_SESSION_HOURS = 12;

function createApp({
  dataFile = path.join(__dirname, 'data', 'db.json'),
  adminPassword = process.env.ADMIN_PASSWORD,
  publicUrl = process.env.PUBLIC_URL,
  now = () => new Date(),
  noShowMinutes = Number(process.env.NO_SHOW_MINUTES) || undefined, // first-run default; then set on the Settings page
  vapidSubject = process.env.VAPID_SUBJECT || 'mailto:laundry@example.com',
  sendPush, // injectable for tests; defaults to real Web Push
} = {}) {
  if (!adminPassword) throw new Error('ADMIN_PASSWORD must be set');

  const store = new Store(dataFile, noShowMinutes ? { noShowMinutes } : {});
  const app = express();

  // --- notifications -----------------------------------------------------------
  const push = sendPush || ((sub, payload) => {
    webpush.setVapidDetails(vapidSubject, store.vapid.publicKey, store.vapid.privateKey);
    return webpush.sendNotification(sub, payload, { TTL: 15 * 60 });
  });
  const notify = (device, payload) => {
    for (const sub of store.subscriptionsFor(device)) {
      Promise.resolve(push(sub, JSON.stringify(payload))).catch((err) => {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) store.removeSubscription(sub.endpoint);
        else console.error('Push failed:', err && err.message);
      });
    }
  };
  const turns = createTurns({ store, notify });
  const nowMs = () => now().getTime();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // --- helpers --------------------------------------------------------------
  const sign = (value) => crypto.createHmac('sha256', store.secret).update(value).digest('base64url');
  const safeEqual = (a, b) => {
    const ab = Buffer.from(String(a)), bb = Buffer.from(String(b));
    return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
  };
  const cookies = (req) =>
    Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((c) => {
      const i = c.indexOf('=');
      return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1).trim())];
    }));
  const setCookie = (res, req, name, value, maxAgeSec) =>
    res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${req.secure ? '; Secure' : ''}`);

  const days = () => {
    const today = todayIn(TIME_ZONE, now());
    return { today, tomorrow: addDays(today, 1) };
  };
  const sweep = () => turns.sweep(days().today, nowMs());

  // Everything the queue views need about today: wait estimates and settings.
  const todayInfo = (list) => ({ ...estimate(list, store.settings, nowMs()), settings: store.settings, now: nowMs() });

  // Daily limit reached? Returns a reason if so.
  const dayClosed = (day, list) => {
    const { dailyLimit } = store.settings;
    if (dailyLimit && list.length >= dailyLimit) return `${day === 'today' ? "Today's" : "Tomorrow's"} list is full.`;
    return null;
  };
  // Keep no-show timers running even when nobody has a page open.
  setInterval(sweep, 15000).unref();

  // Each phone gets an anonymous id so students can only remove their own entry.
  const deviceId = (req, res) => {
    let id = cookies(req).lq_device;
    if (!id || !/^[a-f0-9]{32}$/.test(id)) {
      id = crypto.randomBytes(16).toString('hex');
      setCookie(res, req, 'lq_device', id, 60 * 60 * 24 * 365);
    }
    return id;
  };

  const isAdmin = (req) => {
    const [exp, sig] = (cookies(req).lq_admin || '').split('.');
    return exp && sig && Number(exp) > Date.now() && safeEqual(sig, sign('admin:' + exp));
  };
  const requireAdmin = (req, res, next) => (isAdmin(req) ? next() : res.redirect('/admin/login'));

  const joinUrl = (req) => `${publicUrl || `${req.protocol}://${req.get('host')}`}/join?t=${store.qrToken}`;

  const joinContext = () => {
    const { today, tomorrow } = days();
    const todayList = store.list(today);
    const tomorrowList = store.list(tomorrow);
    // How long a new sign-up for today would wait: add a pretend person at the back.
    const est = estimate([...todayList, { id: '_new', status: 'waiting' }], store.settings, nowMs());
    return {
      token: store.qrToken, today, tomorrow,
      todayWaiting: todayList.filter((e) => e.status === 'waiting').length,
      tomorrowCount: tomorrowList.filter((e) => e.status !== 'done').length,
      todayWaitMs: est.startIn.get('_new'),
      todayClosed: dayClosed('today', todayList),
      tomorrowClosed: dayClosed('tomorrow', tomorrowList),
    };
  };

  const qrSvg = (url, dark = '#0c2c65') => QRCode.toString(url, { type: 'svg', margin: 1, color: { dark } });

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);

  // --- public ---------------------------------------------------------------
  app.get('/', (req, res) => {
    const { today, tomorrow } = days();
    store.prune(today);
    sweep();
    const msgs = { joined: "You're on the list!", left: 'You have been taken off the list.' };
    const device = deviceId(req, res);
    const todayList = store.list(today);
    const tomorrowList = store.list(tomorrow);
    const mySpots = [['today', todayList], ['tomorrow', tomorrowList]].flatMap(([when, list]) => {
      const active = list.filter((e) => e.status !== 'done');
      const i = active.findIndex((e) => e.deviceId === device);
      if (i < 0) return [];
      const ahead = active.slice(0, i).filter((e) => e.status !== 'washing').length;
      return [{ entry: active[i], ahead, when }];
    });
    res.send(views.homePage({
      today, tomorrow, todayList, tomorrowList, mySpots, info: todayInfo(todayList),
      deviceId: device,
      msg: msgs[req.query.m],
      highlight: req.query.id,
    }));
  });

  app.get('/join', (req, res) => {
    if (!safeEqual(req.query.t || '', store.qrToken)) return res.status(403).send(views.scanRequiredPage());
    deviceId(req, res);
    const c = cookies(req);
    res.send(views.joinPage({ ...joinContext(), values: { name: c.lq_name, house: c.lq_house } }));
  });

  app.post('/join', (req, res) => {
    if (!safeEqual(req.body.t || '', store.qrToken)) return res.status(403).send(views.scanRequiredPage());
    const { today, tomorrow } = days();
    const values = { name: clean(req.body.name), house: clean(req.body.house), day: req.body.day };
    const date = values.day === 'tomorrow' ? tomorrow : values.day === 'today' ? today : null;
    const fail = (error) => res.status(400).send(views.joinPage({ ...joinContext(), values, error }));

    if (!values.name || !values.house) return fail('Please fill in your name and house.');
    if (!date) return fail('Please choose today or tomorrow.');
    const closed = dayClosed(values.day, store.list(date));
    if (closed) return fail(closed);

    const device = deviceId(req, res);
    const list = store.list(date).filter((e) => e.status !== 'done');
    if (list.some((e) => e.deviceId === device)) return fail(`This phone is already on ${values.day}'s list.`);
    if (list.some((e) => e.name.toLowerCase() === values.name.toLowerCase())) {
      return fail(`${values.name} is already on ${values.day}'s list.`);
    }

    const entry = store.add(date, { name: values.name, house: values.house, deviceId: device }, nowMs());
    // Remember name/house so next time is a single tap.
    setCookie(res, req, 'lq_name', values.name, 60 * 60 * 24 * 365);
    setCookie(res, req, 'lq_house', values.house, 60 * 60 * 24 * 365);
    res.redirect(`/?m=joined&id=${entry.id}`);
  });

  app.post('/leave/:id', (req, res) => {
    const entry = store.get(req.params.id);
    if (entry && ['waiting', 'called'].includes(entry.status) && entry.deviceId === cookies(req).lq_device) {
      store.remove(entry.id);
      if (entry.status === 'called') turns.callNext(entry.date, nowMs(), { except: entry.id });
    }
    res.redirect('/?m=left');
  });

  // --- live updates + push subscriptions ----------------------------------------
  app.get('/api/version', (req, res) => {
    sweep();
    res.set('Cache-Control', 'no-store').json({ v: store.version });
  });

  app.get('/api/push-key', (req, res) => res.json({ key: store.vapid.publicKey }));

  app.post('/api/subscribe', (req, res) => {
    const sub = req.body && req.body.subscription;
    const device = cookies(req).lq_device;
    const valid = sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 1000
      && sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string';
    if (!device || !valid) return res.status(400).json({ ok: false });
    store.addSubscription(device, { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    res.json({ ok: true });
  });

  // --- laundry room screen (TV / tablet) --------------------------------------
  // Shows the QR code, so it needs the secret display link from the staff page.
  app.get('/display', async (req, res, next) => {
    try {
      if (!safeEqual(req.query.k || '', store.displayKey)) return res.status(403).send(views.scanRequiredPage());
      sweep();
      const { today, tomorrow } = days();
      const list = store.list(today);
      res.send(views.displayPage({
        today, list, info: todayInfo(list),
        tomorrowCount: store.list(tomorrow).length,
        qrSvg: await qrSvg(joinUrl(req), '#0c2c65'),
      }));
    } catch (err) { next(err); }
  });

  // --- admin ----------------------------------------------------------------
  app.get('/admin/login', (req, res) => (isAdmin(req) ? res.redirect('/admin') : res.send(views.loginPage())));

  app.post('/admin/login', (req, res) => {
    if (!safeEqual(req.body.password || '', adminPassword)) {
      return res.status(401).send(views.loginPage({ error: 'Wrong password.' }));
    }
    const exp = String(Date.now() + ADMIN_SESSION_HOURS * 3600e3);
    setCookie(res, req, 'lq_admin', `${exp}.${sign('admin:' + exp)}`, ADMIN_SESSION_HOURS * 3600);
    res.redirect('/admin');
  });

  app.post('/admin/logout', (req, res) => {
    setCookie(res, req, 'lq_admin', '', 0);
    res.redirect('/');
  });

  app.get('/admin', requireAdmin, async (req, res, next) => {
    try {
      sweep();
      const { today, tomorrow } = days();
      const day = req.query.day === 'tomorrow' ? 'tomorrow' : 'today';
      const date = day === 'tomorrow' ? tomorrow : today;
      const url = joinUrl(req);
      const msgs = {
        rotated: 'New QR code generated — print a new poster. The laundry room screen link has changed too.',
        cleared: 'List cleared.',
        saved: 'Settings saved.',
      };
      const active = (d) => store.list(d).filter((e) => e.status !== 'done').length;
      const list = store.list(date);
      res.send(views.adminPage({
        day, date, today, tomorrow, list,
        info: todayInfo(store.list(today)),
        machineFree: turns.machineFree(today),
        counts: { today: active(today), tomorrow: active(tomorrow) },
        qrSvg: await qrSvg(url),
        joinUrl: url,
        displayUrl: `/display?k=${store.displayKey}`,
        msg: msgs[req.query.m],
      }));
    } catch (err) { next(err); }
  });

  app.get('/admin/poster', requireAdmin, async (req, res, next) => {
    try {
      res.send(views.posterPage({ qrSvg: await qrSvg(joinUrl(req)) }));
    } catch (err) { next(err); }
  });

  // Settings page.
  app.get('/admin/settings', requireAdmin, (req, res) => res.send(views.settingsPage({ settings: store.settings })));

  app.post('/admin/settings', requireAdmin, (req, res) => {
    const b = req.body;
    const int = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };
    const next = {
      washMinutes: int(b.washMinutes, 10, 180),
      noShowMinutes: int(b.noShowMinutes, 2, 60),
      dailyLimit: int(b.dailyLimit || 0, 0, 200),
    };
    const bad = Object.entries(next).filter(([, v]) => v === null).map(([k]) => k);
    if (bad.length) {
      return res.status(400).send(views.settingsPage({ settings: { ...store.settings, ...b }, error: 'Please check the highlighted fields.', bad }));
    }
    store.updateSettings(next);
    res.redirect('/admin?m=saved');
  });

  const back = (req, res, m) =>
    res.redirect(`/admin?day=${req.body.day === 'tomorrow' ? 'tomorrow' : 'today'}${m ? `&m=${m}` : ''}`);

  const action = (fn) => (req, res) => {
    fn(req.params.id);
    back(req, res);
  };
  app.post('/admin/start/:id', requireAdmin, action((id) => turns.start(id, nowMs())));
  app.post('/admin/done/:id', requireAdmin, action((id) => turns.finish(id, nowMs())));
  app.post('/admin/skip/:id', requireAdmin, action((id) => turns.skip(id, nowMs())));
  app.post('/admin/reset/:id', requireAdmin, action((id) => store.setStatus(id, 'waiting')));

  app.post('/admin/remove/:id', requireAdmin, (req, res) => {
    store.remove(req.params.id);
    back(req, res);
  });

  // Call the next person if the machine is free.
  app.post('/admin/next/:date', requireAdmin, (req, res) => {
    turns.callNext(req.params.date, nowMs());
    back(req, res);
  });

  app.post('/admin/clear/:date', requireAdmin, (req, res) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) store.clear(req.params.date);
    back(req, res, 'cleared');
  });

  app.post('/admin/rotate-qr', requireAdmin, (req, res) => {
    store.rotateQrToken();
    res.redirect('/admin?m=rotated');
  });

  return app;
}

if (require.main === module) {
  if (!process.env.ADMIN_PASSWORD) {
    console.error('Set ADMIN_PASSWORD before starting, e.g.  ADMIN_PASSWORD=secret npm start');
    process.exit(1);
  }
  const port = Number(process.env.PORT) || 3000;
  const app = createApp();
  app.listen(port, () => console.log(`Laundry queue running on http://localhost:${port}`));
}

module.exports = { createApp };
