const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATUS_LABEL = { waiting: 'Waiting', called: 'Called', washing: 'Washing', done: 'Done' };

const WASHER_ICON = `<svg class="icon-washer" viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="4" width="36" height="40" rx="6" fill="none" stroke="currentColor" stroke-width="3"/><line x1="6" y1="13" x2="42" y2="13" stroke="currentColor" stroke-width="3"/><circle cx="13" cy="8.5" r="1.8" fill="currentColor"/><circle cx="19" cy="8.5" r="1.8" fill="currentColor"/><circle cx="24" cy="28" r="10" fill="none" stroke="currentColor" stroke-width="3"/><path class="wave" d="M17 29c2.5-2.5 4.5 2.5 7 0s4.5 2.5 7 0" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;
const BELL_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon icon-bell"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2z"/></svg>`;
const QR_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true" class="icon"><path fill="currentColor" d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v8h-8V3zm2 2v4h4V5h-4zM3 13h8v8H3v-8zm2 2v4h4v-4H5zm8-2h2v2h-2v-2zm2 2h2v2h-2v-2zm2-2h2v2h-2v-2zm2 2h2v2h-2v-2zm-6 2h2v2h-2v-2zm2 2h2v2h-2v-2zm2-2h2v2h-2v-2zm2 2h2v2h-2v-2z"/></svg>`;

function prettyDate(date, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });
}
const shortDate = (date) => prettyDate(date, { weekday: 'short', day: 'numeric', month: 'short' });

const countdown = (calledAt, noShowMs) =>
  `<span class="countdown" data-deadline="${calledAt + noShowMs}">${Math.round(noShowMs / 60000)}:00</span>`;

const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');

function layout({ title, body, admin = false, live = false, bodyClass = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0c2c65">
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
        ? '<a href="/">Queue</a><form method="post" action="/admin/logout"><button class="link">Log out</button></form>'
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

function queueList(entries, { deviceId, highlight }) {
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
      return `<li class="q-item q-${e.status}${mine ? ' q-mine' : ''}${e.id === highlight ? ' q-new' : ''}">
        <span class="q-pos">${n ?? (e.status === 'called' ? BELL_ICON : WASHER_ICON)}</span>
        <span class="q-who"><strong>${esc(e.name)}${mine ? ' <em>(you)</em>' : ''}</strong><small>${esc(e.house)}</small></span>
        ${e.status === 'washing' || e.status === 'called' ? `<span class="chip chip-${e.status}">${STATUS_LABEL[e.status]}</span>` : ''}
      </li>`;
    })
    .join('')}</ol>
    ${done ? `<p class="done-note">✓ ${done} finished</p>` : ''}`;
}

function mySpotCard(spot, noShowMs) {
  if (!spot) return '';
  const { entry, ahead, when } = spot;
  let headline, sub;
  if (entry.status === 'called') {
    headline = "It's your turn!";
    sub = `Bring your laundry to the laundry room now. Time left: ${countdown(entry.calledAt, noShowMs)}`;
  } else if (entry.status === 'washing') {
    headline = "Your laundry's in";
    sub = 'Staff have started your wash.';
  } else if (when === 'tomorrow') {
    headline = `You're ${ordinal(ahead + 1)} for tomorrow`;
    sub = 'Check back tomorrow to see the queue move.';
  } else if (ahead === 0) {
    headline = "You're next!";
    sub = 'Have your laundry ready.';
  } else {
    headline = `You're ${ordinal(ahead + 1)} in line`;
    sub = `${ahead} ${ahead === 1 ? 'person' : 'people'} ahead of you.`;
  }
  if (entry.status === 'waiting' && entry.misses) {
    sub += ' You missed your turn once — miss it again and you\'ll be taken off the list.';
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
    ${notifyBtn ? `<div class="my-spot-push">${notifyBtn}</div>` : ''}
  </div>`;
}

function homePage({ today, tomorrow, todayList, tomorrowList, deviceId, msg, highlight, mySpots, noShowMs }) {
  const washing = todayList.filter((e) => e.status === 'washing');
  const waiting = todayList.filter((e) => e.status === 'waiting');
  const called = todayList.find((e) => e.status === 'called');
  const myTurn = mySpots.some((s) => s.entry.status === 'called');
  const nowText = washing.length ? washing.map((e) => esc(e.name)).join(', ') : 'Machine free';
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
        <div><p class="now-label">Now washing</p><p class="now-value">${nowText}</p></div>
      </div>
      <div class="now-side">
        <div><p class="now-label">${called ? 'Called' : 'Next up'}</p><p class="now-value small">${called ? esc(called.name) : waiting[0] ? esc(waiting[0].name) : '—'}</p></div>
        <div><p class="now-label">Waiting</p><p class="now-value small">${waiting.length}</p></div>
      </div>
    </div>
    ${mySpots.map((spot) => mySpotCard(spot, noShowMs)).join('')}
  </div>
</section>
<main class="wrap">
  ${flash(msg)}
  ${mySpots.length ? '' : `<div class="scan-tip">${QR_ICON}<p><strong>Want a turn?</strong> Scan the QR code in the laundry room with your phone camera.</p></div>`}
  <div class="grid-2">
    <section class="card">
      <h2>Today <small>${shortDate(today)}</small></h2>
      ${queueList(todayList, { deviceId, highlight })}
    </section>
    <section class="card">
      <h2>Tomorrow <small>${shortDate(tomorrow)}</small></h2>
      ${queueList(tomorrowList, { deviceId, highlight })}
    </section>
  </div>
  <p class="refresh-note">This page updates by itself.</p>
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

function joinPage({ token, today, tomorrow, todayWaiting, tomorrowCount, values = {}, error }) {
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
        <button class="day-btn day-today" name="day" value="today">
          <span class="day-name">Today</span>
          <span class="day-meta">${shortDate(today)} · ${todayWaiting} waiting</span>
          <span class="day-arrow" aria-hidden="true">→</span>
        </button>
        <button class="day-btn day-tomorrow" name="day" value="tomorrow">
          <span class="day-name">Tomorrow</span>
          <span class="day-meta">${shortDate(tomorrow)} · ${tomorrowCount} signed up</span>
          <span class="day-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </form>
  </section>
</main>`,
  });
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

function adminRows(entries, day) {
  if (!entries.length) return '<p class="empty">No one signed up.</p>';
  const btn = (id, label, path, cls = 'btn-outline', confirmMsg) =>
    `<form method="post" action="/admin/${path}/${esc(id)}"${confirmMsg ? ` onsubmit="return confirm('${confirmMsg}')"` : ''}>
      <input type="hidden" name="day" value="${day}"><button class="btn btn-small ${cls}">${label}</button></form>`;
  let pos = 0;
  return `<ol class="admin-list">${entries
    .map((e) => {
      const n = e.status === 'waiting' ? ++pos : null;
      const time = new Date(e.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
      return `<li class="a-item a-${e.status}">
        <span class="q-pos">${n ?? ({ washing: WASHER_ICON, called: BELL_ICON }[e.status] || '✓')}</span>
        <span class="q-who"><strong>${esc(e.name)}</strong><small>${esc(e.house)} · ${time}${e.misses ? ` · <span class="missed">missed ${e.misses}×</span>` : ''}</small></span>
        <span class="chip chip-${e.status}">${STATUS_LABEL[e.status]}</span>
        <span class="a-actions">
          ${e.status === 'washing' ? btn(e.id, 'Done', 'done') : ''}
          ${e.status === 'done' ? btn(e.id, 'Undo', 'reset') : ''}
          ${btn(e.id, 'Remove', 'remove', 'btn-danger', 'Remove this person from the list?')}
        </span>
      </li>`;
    })
    .join('')}</ol>`;
}

function adminPage({ day, date, today, tomorrow, list, counts, qrSvg, joinUrl, msg, noShowMs }) {
  const washing = list.filter((e) => e.status === 'washing');
  const next = list.find((e) => e.status === 'waiting');
  const called = list.find((e) => e.status === 'called');
  const hidden = (id) => `<input type="hidden" name="day" value="${day}">`;
  const calledPanel = called ? `<div class="called-panel">
      <div class="called-text">${BELL_ICON}<div><p class="now-label">Called · waiting to arrive</p>
        <p class="called-name">${esc(called.name)}</p>
        <p class="small">Auto-skipped in ${countdown(called.calledAt, noShowMs)}</p></div></div>
      <div class="called-actions">
        <form method="post" action="/admin/start/${esc(called.id)}">${hidden()}<button class="btn">Arrived — start wash</button></form>
        <form method="post" action="/admin/skip/${esc(called.id)}">${hidden()}<button class="btn btn-outline">Not here — skip</button></form>
      </div>
    </div>` : '';
  const nextBtn = day === 'today' && !called && (next || washing.length) ? `<form method="post" action="/admin/next/${date}" class="next-form">
      ${hidden()}
      <button class="btn btn-block btn-gold"><span>${next
        ? `${washing.length ? 'Finish current &amp; call' : 'Call'} next: <strong>${esc(next.name)}</strong>`
        : 'Mark current wash as done'}</span></button>
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
  <h1 class="page-title">Manage queue</h1>
  ${flash(msg)}
  <nav class="tabs">${tab('today', 'Today', today)}${tab('tomorrow', 'Tomorrow', tomorrow)}</nav>
  <section class="card">
    ${calledPanel}${nextBtn}
    ${adminRows(list, day)}
    ${list.length ? `<form method="post" action="/admin/clear/${date}" class="clear-form" onsubmit="return confirm('Remove everyone from this list?')">
      <input type="hidden" name="day" value="${day}"><button class="link link-danger">Clear whole list</button>
    </form>` : ''}
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

module.exports = { homePage, scanRequiredPage, joinPage, loginPage, adminPage, posterPage };
