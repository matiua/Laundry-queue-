const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATUS_LABEL = { waiting: 'Waiting', called: 'Called', washing: 'Washing', done: 'Done' };

const WASHER_ICON = `<svg class="icon-washer" viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="4" width="36" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="3"/><line x1="6" y1="13" x2="42" y2="13" stroke="currentColor" stroke-width="3"/><circle cx="13" cy="8.5" r="1.8" fill="currentColor"/><circle cx="19" cy="8.5" r="1.8" fill="currentColor"/><circle cx="24" cy="28" r="10" fill="none" stroke="currentColor" stroke-width="3"/><path class="wave" d="M17 29c2.5-2.5 4.5 2.5 7 0s4.5 2.5 7 0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;
const BELL_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon icon-bell"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2z"/></svg>`;
const QR_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><path fill="currentColor" d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h2v2h-2v-2zm2 2h2v2h-2v-2zm2-2h2v2h-2v-2zm2 2h2v2h-2v-2zm-6 2h2v2h-2v-2zm2 2h2v2h-2v-2zm2-2h2v2h-2v-2zm2 2h2v2h-2v-2z"/></svg>`;
const SCREEN_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><path fill="currentColor" d="M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v9h16V6H4z"/></svg>`;

function prettyDate(date, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
}
const shortDate = (date) => prettyDate(date, { weekday: 'short', day: 'numeric', month: 'short' });
const clockTime = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });

const countdown = (calledAt, noShowMs) =>
  `<span class="countdown" data-deadline="${calledAt + noShowMs}">${Math.round(noShowMs / 60000)}:00</span>`;

const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');

// "about 25 min", "about 1 h 15 min", "any minute now"
function fmtWait(ms) {
  const min = Math.round(ms / 60000);
  if (min <= 3) return 'any minute now';
  const r = Math.max(5, Math.round(min / 5) * 5);
  return r < 60 ? `about ${r} min` : `about ${Math.floor(r / 60)} h${r % 60 ? ` ${r % 60} min` : ''}`;
}
const shortWait = (ms) => (Math.round(ms / 60000) <= 3 ? 'now' : `~${fmtWait(ms).replace('about ', '')}`);

// "x min left" for the running wash (kept up to date by app.js).
function washLeft(entry, washMs, now) {
  const end = entry.startedAt + washMs;
  const left = Math.max(0, Math.ceil((end - now) / 60000));
  return `<span class="wash-left" data-left-for="${end}">${left ? `${left} min left` : 'Finishing up'}</span>`;
}

function layout({ title, body, admin = false, live = false, bodyClass = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0c2c65">
<meta name="color-scheme" content="light dark">
${live ? '<noscript><meta http-equiv="refresh" content="30"></noscript>' : ''}
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon-192.png">
<link rel="icon" href="/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<script src="/app.js" defer></script>
<title>${esc(title)} · Boarding Laundry</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
</head>
<body class="${bodyClass}"${live ? ' data-live' : ''}>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/" aria-label="Laundry queue home">
      <img src="/logo.svg" alt="Scarborough College" width="154" height="48">
      <span class="brand-tag">Laundry</span>
    </a>
    <nav class="nav">
      ${admin
        ? '<a href="/">Queue</a><a href="/admin">Manage</a><a href="/admin/settings">Settings</a><form method="post" action="/admin/logout"><button class="link">Log out</button></form>'
        : '<a href="/admin">Staff</a>'}
    </nav>
  </div>
</header>
${body}
</body>
</html>`;
}

function flash(msg, kind = 'ok') {
  return msg ? `<div class="flash flash-${kind}" role="status">${esc(msg)}</div>` : '';
}

// --- public queue -----------------------------------------------------------

function queueList(entries, { deviceId, highlight, info }) {
  const active = entries.filter((e) => e.status !== 'done');
  const done = entries.length - active.length;
  if (!active.length) {
    return `<p class="empty">${done ? `All ${done} done for the day 🎉` : 'No one yet.'}</p>`;
  }
  let pos = 0;
  return `<ol class="queue">${active
    .map((e) => {
      const n = e.status === 'waiting' ? ++pos : null;
      const mine = deviceId && e.deviceId === deviceId;
      let side = '';
      if (e.status === 'washing') side = '<span class="chip chip-washing">Washing</span>';
      else if (e.status === 'called') side = '<span class="chip chip-called">Called</span>';
      else if (info && info.startIn.has(e.id)) side = `<span class="q-eta">${shortWait(info.startIn.get(e.id))}</span>`;
      return `<li class="q-item q-${e.status}${mine ? ' q-mine' : ''}${e.id === highlight ? ' q-new' : ''}">
        <span class="q-pos">${n ?? (e.status === 'called' ? BELL_ICON : WASHER_ICON)}</span>
        <span class="q-who"><strong>${esc(e.name)}${mine ? ' <em>(you)</em>' : ''}</strong><small>${esc(e.house)}</small></span>
        ${side}
      </li>`;
    })
    .join('')}</ol>
    ${done ? `<p class="done-note">✓ ${done} finished</p>` : ''}`;
}

function mySpotCard(spot, info) {
  if (!spot) return '';
  const { entry, ahead, when } = spot;
  const noShowMs = info.settings.noShowMinutes * 60000;
  let headline, sub;
  if (entry.status === 'called') {
    headline = "It's your turn!";
    sub = `Bring your laundry to the laundry room now. Time left: ${countdown(entry.calledAt, noShowMs)}`;
  } else if (entry.status === 'washing') {
    headline = "Your laundry's in";
    sub = `Your wash is on — ${washLeft(entry, info.settings.washMinutes * 60000, info.now)}. When you've taken your laundry out, let the next person know the machine is free.`;
  } else if (when === 'tomorrow') {
    headline = `You're ${ordinal(ahead + 1)} for tomorrow`;
    sub = 'Check back tomorrow to see the queue move.';
  } else {
    const wait = info.startIn.get(entry.id) || 0;
    headline = ahead === 0 ? "You're next!" : `You're ${ordinal(ahead + 1)} in line`;
    sub = ahead === 0 ? 'Have your laundry ready.' : `${ahead} ${ahead === 1 ? 'person' : 'people'} ahead of you.`;
    sub += ` <span class="eta">Estimated turn: <strong>${fmtWait(wait)}</strong>${Math.round(wait / 60000) > 3 ? ` (around ${clockTime(info.now + wait)})` : ''}.</span>`;
  }
  if (entry.status === 'waiting' && entry.misses) {
    sub += ' <span class="warn">You missed your turn once — miss it again and you\'ll be taken off the list.</span>';
  }
  const notifyBtn = entry.status === 'waiting'
    ? `<button type="button" class="btn btn-navy btn-small" data-enable-push hidden>${BELL_ICON} Notify me when it's my turn</button>
       <p class="push-note" data-push-on hidden>${BELL_ICON} Notifications on — we'll ping this phone when it's your turn.</p>
       <p class="push-note" data-push-blocked hidden>${BELL_ICON} Notifications are blocked for this site. Allow them in your browser settings to get a ping when it's your turn.</p>
       <p class="push-note" data-ios-hint hidden>To get a notification on iPhone: tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, then open the queue from there.</p>`
    : '';
  return `<div class="my-spot my-spot-${entry.status}">
    <div class="my-spot-text"><p class="my-spot-label">Your spot · ${when}</p><p class="my-spot-head">${headline}</p><p class="my-spot-sub">${sub}</p></div>
    ${['waiting', 'called'].includes(entry.status)
      ? `<form method="post" action="/leave/${esc(entry.id)}" onsubmit="return confirm('Take yourself off the list?')"><button class="btn btn-light btn-small">${entry.status === 'called' ? "Can't make it" : 'Leave queue'}</button></form>`
      : ''}
    ${entry.status === 'washing'
      ? `<form method="post" action="/finish/${esc(entry.id)}" class="finish-form" onsubmit="return confirm('Have you taken your laundry out? The next person will be told the machine is free.')">
          <button class="btn btn-navy btn-block">✓ I'm done — machine is free</button></form>`
      : ''}
    ${notifyBtn ? `<div class="my-spot-push">${notifyBtn}</div>` : ''}
  </div>`;
}

function homePage({ today, tomorrow, todayList, tomorrowList, deviceId, msg, highlight, mySpots, info }) {
  const waiting = todayList.filter((e) => e.status === 'waiting');
  const called = todayList.filter((e) => e.status === 'called');
  const washing = todayList.find((e) => e.status === 'washing');
  const myTurn = mySpots.some((s) => s.entry.status === 'called');
  return layout({
    title: myTurn ? "🔔 It's your turn!" : 'Queue',
    live: true,
    body: `
<section class="hero">
  <div class="wrap">
    <p class="hero-date">${prettyDate(today)}</p>
    <h1>Laundry queue</h1>
    <div class="now">
      <div class="now-main">
        ${WASHER_ICON}
        <div><p class="now-label">Now washing</p>
          <p class="now-value">${washing ? esc(washing.name) : 'Machine free'}</p>
          ${washing ? `<p class="now-sub">${washLeft(washing, info.settings.washMinutes * 60000, info.now)}</p>` : ''}</div>
      </div>
      <div class="now-side">
        <div><p class="now-label">${called.length ? 'Called' : 'Next up'}</p><p class="now-value small">${called.length ? esc(called[0].name) : waiting[0] ? esc(waiting[0].name) : '—'}</p></div>
        <div><p class="now-label">Waiting</p><p class="now-value small">${waiting.length}</p></div>
      </div>
    </div>
    ${mySpots.map((spot) => mySpotCard(spot, info)).join('')}
  </div>
</section>
<main class="wrap">
  ${flash(msg)}
  ${mySpots.length ? '' : `<div class="scan-tip">${QR_ICON}<p><strong>Want a turn?</strong> Scan the QR code in the laundry room with your phone camera.</p></div>`}
  <div class="grid-2">
    <section class="card">
      <h2>Today <small>${shortDate(today)}</small></h2>
      ${queueList(todayList, { deviceId, highlight, info })}
    </section>
    <section class="card">
      <h2>Tomorrow <small>${shortDate(tomorrow)}</small></h2>
      ${queueList(tomorrowList, { deviceId, highlight })}
    </section>
  </div>
  <p class="refresh-note">This page updates by itself. Times are estimates.</p>
</main>`,
  });
}

function scanRequiredPage() {
  return layout({
    title: 'Scan to join',
    bodyClass: 'tint',
    body: `
<main class="wrap">
  <section class="card narrow center">
    <div class="big-icon">${QR_ICON}</div>
    <h1>Scan the QR code to join</h1>
    <p class="muted">Point your phone camera at the QR code in the laundry room. If it's not working, scan it again — the code may have been updated.</p>
    <a class="btn btn-block" href="/">See the queue</a>
  </section>
</main>`,
  });
}

function joinPage({ token, today, tomorrow, todayWaiting, tomorrowCount, todayWaitMs, todayClosed, tomorrowClosed, values = {}, error }) {
  const dayBtn = (key, label, date, meta, closed) => `
        <button class="day-btn day-${key}" name="day" value="${key}"${closed ? ' disabled' : ''}>
          <span class="day-name">${label}</span>
          <span class="day-meta">${shortDate(date)} · ${closed ? esc(closed.replace(/\.$/, '')) : meta}</span>
          <span class="day-arrow" aria-hidden="true">${closed ? '' : '→'}</span>
        </button>`;
  const todayMeta = todayWaiting ? `${todayWaiting} waiting · ${shortWait(todayWaitMs)} wait` : 'no wait';
  return layout({
    title: 'Join the queue',
    bodyClass: 'tint',
    body: `
<main class="wrap">
  <section class="card narrow join">
    <h1>Join the queue</h1>
    <p class="muted">Add your name, then pick a day.</p>
    ${flash(error, 'error')}
    <form method="post" action="/join" class="form">
      <input type="hidden" name="t" value="${esc(token)}">
      <label>Your name
        <input name="name" required maxlength="40" autocomplete="name" value="${esc(values.name)}" placeholder="First and last name">
      </label>
      <label>House &amp; room
        <input name="house" required maxlength="40" value="${esc(values.house)}" placeholder="e.g. Ashville, room 12">
      </label>
      <div class="day-buttons">
        ${dayBtn('today', 'Today', today, todayMeta, todayClosed)}
        ${dayBtn('tomorrow', 'Tomorrow', tomorrow, `${tomorrowCount} signed up`, tomorrowClosed)}
      </div>
    </form>
  </section>
</main>`,
  });
}

// --- laundry room screen ----------------------------------------------------

function displayPage({ today, list, info, tomorrowCount, qrSvg }) {
  const noShowMs = info.settings.noShowMinutes * 60000;
  const washing = list.find((e) => e.status === 'washing');
  const called = list.filter((e) => e.status === 'called');
  const waiting = list.filter((e) => e.status === 'waiting');
  const shown = waiting.slice(0, 6);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Laundry queue · Laundry room</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css"><script src="/app.js" defer></script></head>
<body class="display" data-live>
  <header class="d-head">
    <img src="/logo.svg" alt="Scarborough College">
    <div class="d-title"><p class="hero-date">${prettyDate(today)}</p><h1>Laundry queue</h1></div>
    <div class="d-clock"><span data-clock>${clockTime(info.now)}</span></div>
  </header>
  <main class="d-main">
    <section class="d-left">
      <div class="d-now${washing ? '' : ' free'}">
        ${WASHER_ICON}
        <div><p class="now-label">Now washing</p>
          <p class="d-now-name">${washing ? esc(washing.name) : 'Machine free'}</p>
          ${washing ? `<p class="now-sub">${washLeft(washing, info.settings.washMinutes * 60000, info.now)}</p>` : ''}</div>
      </div>
      ${called.length ? `<div class="d-called">${called.map((e) => `<div class="d-called-item">${BELL_ICON}<div>
          <p class="now-label">Called — come now</p><p class="d-called-name">${esc(e.name)}</p></div>
          <span class="d-called-time">${countdown(e.calledAt, noShowMs)}</span></div>`).join('')}</div>` : ''}
      <div class="d-queue">
        <h2>Up next</h2>
        ${shown.length ? `<ol>${shown.map((e, i) => `<li><span class="q-pos">${i + 1}</span><span class="d-name">${esc(e.name)}</span><span class="d-eta">${shortWait(info.startIn.get(e.id))}</span></li>`).join('')}</ol>`
          : '<p class="empty">No one waiting — scan to go next!</p>'}
        ${waiting.length > shown.length ? `<p class="d-more">+ ${waiting.length - shown.length} more waiting</p>` : ''}
        ${tomorrowCount ? `<p class="d-more">${tomorrowCount} signed up for tomorrow</p>` : ''}
      </div>
    </section>
    <aside class="d-right">
      <div class="d-qr">${qrSvg}</div>
      <p class="d-scan">Scan to join</p>
      <p class="d-scan-sub">Point your phone camera at the code</p>
    </aside>
  </main>
</body></html>`;
}

// --- admin ------------------------------------------------------------------

function loginPage({ error } = {}) {
  return layout({
    title: 'Staff login',
    bodyClass: 'tint',
    body: `
<main class="wrap">
  <section class="card narrow">
    <h1>Staff login</h1>
    <p class="muted">For boarding staff managing the laundry queue.</p>
    ${flash(error, 'error')}
    <form method="post" action="/admin/login" class="form">
      <label>Password <input type="password" name="password" required autofocus autocomplete="current-password"></label>
      <button class="btn btn-block">Log in</button>
    </form>
  </section>
</main>`,
  });
}

const adminBtn = (day, id, label, path, cls = 'btn-outline', confirmMsg) =>
  `<form method="post" action="/admin/${path}/${esc(id)}"${confirmMsg ? ` onsubmit="return confirm('${confirmMsg}')"` : ''}>
    <input type="hidden" name="day" value="${day}"><button class="btn btn-small ${cls}">${label}</button></form>`;

function adminRows(entries, day) {
  if (!entries.length) return '<p class="empty">No one signed up.</p>';
  let pos = 0;
  return `<ol class="admin-list">${entries
    .map((e) => {
      const n = e.status === 'waiting' ? ++pos : null;
      const time = clockTime(e.createdAt);
      return `<li class="a-item a-${e.status}">
        <span class="q-pos">${n ?? ({ washing: WASHER_ICON, called: BELL_ICON }[e.status] || '✓')}</span>
        <span class="q-who"><strong>${esc(e.name)}</strong><small>${esc(e.house)} · ${time}${e.misses ? ` · <span class="missed">missed ${e.misses}×</span>` : ''}</small></span>
        <span class="chip chip-${e.status}">${STATUS_LABEL[e.status]}</span>
        <span class="a-actions">
          ${e.status === 'washing' ? adminBtn(day, e.id, 'Done', 'done', '') : ''}
          ${e.status === 'done' ? adminBtn(day, e.id, 'Undo', 'reset') : ''}
          ${adminBtn(day, e.id, 'Remove', 'remove', 'btn-danger', 'Remove this person from the list?')}
        </span>
      </li>`;
    })
    .join('')}</ol>`;
}

function adminPage({ day, date, today, tomorrow, list, info, machineFree, counts, qrSvg, joinUrl, displayUrl, msg }) {
  const { noShowMinutes } = info.settings;
  const noShowMs = noShowMinutes * 60000;
  const isToday = day === 'today';
  const waiting = list.filter((e) => e.status === 'waiting');
  const called = list.filter((e) => e.status === 'called');
  const hidden = `<input type="hidden" name="day" value="${day}">`;

  const calledPanels = called.map((c) => `<div class="called-panel">
      <div class="called-text">${BELL_ICON}<div><p class="now-label">Called · waiting to arrive</p>
        <p class="called-name">${esc(c.name)}</p>
        <p class="small">Auto-skipped in ${countdown(c.calledAt, noShowMs)}</p></div></div>
      <div class="called-actions">
        <form method="post" action="/admin/start/${esc(c.id)}">${hidden}<button class="btn">Arrived — start wash</button></form>
        <form method="post" action="/admin/skip/${esc(c.id)}">${hidden}<button class="btn btn-outline">Not here — skip</button></form>
      </div>
    </div>`).join('');

  const nextBtn = isToday && machineFree && waiting.length ? `<form method="post" action="/admin/next/${date}" class="next-form">
      ${hidden}
      <button class="btn btn-block btn-gold"><span>${BELL_ICON} Call next: <strong>${esc(waiting[0].name)}</strong></span></button>
    </form>` : '';

  const tab = (key, label, d) =>
    `<a class="tab${day === key ? ' active' : ''}" href="/admin?day=${key}">${label} <small>${shortDate(d)}</small><span class="count">${counts[key]}</span></a>`;
  return layout({
    title: 'Admin',
    admin: true,
    live: true,
    bodyClass: 'tint',
    body: `
<main class="wrap">
  <div class="page-head"><h1 class="page-title">Manage queue</h1></div>
  ${flash(msg)}
  <nav class="tabs">${tab('today', 'Today', today)}${tab('tomorrow', 'Tomorrow', tomorrow)}</nav>
  <section class="card">
    ${isToday ? calledPanels + nextBtn : ''}
    ${adminRows(list, day)}
    ${list.length ? `<form method="post" action="/admin/clear/${date}" class="clear-form" onsubmit="return confirm('Remove everyone from this list?')">
      ${hidden}<button class="link link-danger">Clear whole list</button>
    </form>` : ''}
  </section>
  <section class="card tool-card">
    <div class="tool-text">${SCREEN_ICON}<div><h2>Laundry room screen</h2>
      <p class="muted small">Open this on a TV or tablet in the laundry room. It shows who's washing, the queue and the QR code to join.</p></div></div>
    <a class="btn btn-outline" href="${esc(displayUrl)}" target="_blank">Open screen</a>
  </section>
  <details class="card qr-card">
    <summary><span>${QR_ICON} Sign-up QR code</span><small>Print &amp; manage</small></summary>
    <div class="qr-body">
      <div class="qr">${qrSvg}</div>
      <div>
        <p>Put this up in the laundry room. Students can only join by scanning it.</p>
        <p class="muted small break">${esc(joinUrl)}</p>
        <div class="row">
          <a class="btn" href="/admin/poster" target="_blank">Print poster</a>
          <form method="post" action="/admin/rotate-qr" onsubmit="return confirm('Old QR codes (and photos of them) will stop working. You will need to print a new poster. Continue?')">
            <button class="btn btn-outline">New code</button>
          </form>
        </div>
      </div>
    </div>
  </details>
</main>`,
  });
}

function settingsPage({ settings, error, bad = [] }) {
  const field = (name, label, help, attrs) => `
    <label class="${bad.includes(name) ? 'invalid' : ''}">${label}
      <input name="${name}" value="${esc(settings[name])}" ${attrs}>
      <small>${help}</small>
    </label>`;
  return layout({
    title: 'Settings',
    admin: true,
    bodyClass: 'tint',
    body: `
<main class="wrap">
  <div class="page-head"><h1 class="page-title">Settings</h1></div>
  ${flash(error, 'error')}
  <form method="post" action="/admin/settings" class="settings">
    <section class="card">
      <div class="form-grid">
        ${field('washMinutes', 'Wash length (minutes)', 'Used for "minutes left" and wait estimates.', 'type="number" min="10" max="180" required')}
        ${field('noShowMinutes', 'Time to turn up (minutes)', 'After this, a called student goes to the back of the queue.', 'type="number" min="2" max="60" required')}
        ${field('dailyLimit', 'Daily sign-up limit', 'Most people who can sign up for one day. 0 = no limit.', 'type="number" min="0" max="200" required')}
      </div>
    </section>
    <div class="settings-actions"><a class="btn btn-outline" href="/admin">Cancel</a><button class="btn">Save settings</button></div>
  </form>
</main>`,
  });
}

function posterPage({ qrSvg }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Laundry queue poster</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css"></head>
<body class="poster">
  <div class="poster-inner">
    <div class="poster-top"><img src="/logo.svg" alt="Scarborough College"></div>
    <div class="poster-body">
      <h1>Laundry queue</h1>
      <p class="lead">Scan to put your name down for today or tomorrow</p>
      <div class="poster-qr">${qrSvg}</div>
      <p class="poster-hint">Open your phone camera and point it at the code</p>
    </div>
  </div>
  <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body></html>`;
}

module.exports = { homePage, scanRequiredPage, joinPage, loginPage, adminPage, settingsPage, displayPage, posterPage };
