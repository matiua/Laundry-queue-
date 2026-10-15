const path = require('path');
const crypto = require('crypto');
const express = require('express');
const QRCode = require('qrcode');
const { Store, todayIn, addDays } = require('./lib/store');
const views = require('./lib/views');

const TIME_ZONE = 'Europe/London';
const ADMIN_SESSION_HOURS = 12;

function createApp({
  dataFile = path.join(__dirname, 'data', 'db.json'),
  adminPassword = process.env.ADMIN_PASSWORD,
  publicUrl = process.env.PUBLIC_URL,
  now = () => new Date(),
} = {}) {
  if (!adminPassword) throw new Error('ADMIN_PASSWORD must be set');

  const store = new Store(dataFile);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.urlencoded({ extended: false }));
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
    return {
      token: store.qrToken, today, tomorrow,
      todayWaiting: store.list(today).filter((e) => e.status === 'waiting').length,
      tomorrowCount: store.list(tomorrow).filter((e) => e.status !== 'done').length,
    };
  };

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);

  // --- public ---------------------------------------------------------------
  app.get('/', (req, res) => {
    const { today, tomorrow } = days();
    store.prune(today);
    const msgs = { joined: "You're on the list!", left: 'You have been taken off the list.' };
    const device = deviceId(req, res);
    const todayList = store.list(today);
    const tomorrowList = store.list(tomorrow);
    const mySpots = [['today', todayList], ['tomorrow', tomorrowList]].flatMap(([when, list]) => {
      const active = list.filter((e) => e.status !== 'done');
      const entry = active.find((e) => e.deviceId === device);
      if (!entry) return [];
      const ahead = active.filter((e) => e.status === 'waiting' && e.createdAt < entry.createdAt).length;
      return [{ entry, ahead, when }];
    });
    res.send(views.homePage({
      today, tomorrow, todayList, tomorrowList, mySpots,
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

    const device = deviceId(req, res);
    const list = store.list(date).filter((e) => e.status !== 'done');
    if (list.some((e) => e.deviceId === device)) return fail(`This phone is already on ${values.day}'s list.`);
    if (list.some((e) => e.name.toLowerCase() === values.name.toLowerCase())) {
      return fail(`${values.name} is already on ${values.day}'s list.`);
    }

    const entry = store.add(date, { name: values.name, house: values.house, deviceId: device });
    // Remember name/house so next time is a single tap.
    setCookie(res, req, 'lq_name', values.name, 60 * 60 * 24 * 365);
    setCookie(res, req, 'lq_house', values.house, 60 * 60 * 24 * 365);
    res.redirect(`/?m=joined&id=${entry.id}`);
  });

  app.post('/leave/:id', (req, res) => {
    const entry = store.get(req.params.id);
    if (entry && entry.status === 'waiting' && entry.deviceId === cookies(req).lq_device) store.remove(entry.id);
    res.redirect('/?m=left');
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
      const { today, tomorrow } = days();
      const day = req.query.day === 'tomorrow' ? 'tomorrow' : 'today';
      const date = day === 'tomorrow' ? tomorrow : today;
      const url = joinUrl(req);
      const msgs = { rotated: 'New QR code generated — print a new poster.', cleared: 'List cleared.' };
      const active = (d) => store.list(d).filter((e) => e.status !== 'done').length;
      res.send(views.adminPage({
        day, date, today, tomorrow,
        list: store.list(date),
        counts: { today: active(today), tomorrow: active(tomorrow) },
        qrSvg: await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#0c2c65' } }),
        joinUrl: url,
        msg: msgs[req.query.m],
      }));
    } catch (err) { next(err); }
  });

  app.get('/admin/poster', requireAdmin, async (req, res, next) => {
    try {
      const qrSvg = await QRCode.toString(joinUrl(req), { type: 'svg', margin: 1, color: { dark: '#0c2c65' } });
      res.send(views.posterPage({ qrSvg }));
    } catch (err) { next(err); }
  });

  const back = (req, res, m) =>
    res.redirect(`/admin?day=${req.body.day === 'tomorrow' ? 'tomorrow' : 'today'}${m ? `&m=${m}` : ''}`);

  const statusAction = (status) => (req, res) => {
    store.setStatus(req.params.id, status);
    back(req, res);
  };
  app.post('/admin/start/:id', requireAdmin, statusAction('washing'));
  app.post('/admin/done/:id', requireAdmin, statusAction('done'));
  app.post('/admin/reset/:id', requireAdmin, statusAction('waiting'));

  app.post('/admin/remove/:id', requireAdmin, (req, res) => {
    store.remove(req.params.id);
    back(req, res);
  });

  // One tap: finish whatever is washing and start the next person waiting.
  app.post('/admin/next/:date', requireAdmin, (req, res) => {
    const list = store.list(req.params.date);
    list.filter((e) => e.status === 'washing').forEach((e) => store.setStatus(e.id, 'done'));
    const next = list.find((e) => e.status === 'waiting');
    if (next) store.setStatus(next.id, 'washing');
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
  createApp().listen(port, () => console.log(`Laundry queue running on http://localhost:${port}`));
}

module.exports = { createApp };
