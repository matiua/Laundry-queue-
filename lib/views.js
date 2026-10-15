const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const STATUS_LABEL = { waiting: 'Waiting', washing: 'In the machine', done: 'Done' };

function prettyDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
}

function layout({ title, body, admin = false, refresh = 0 }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ''}
<title>${esc(title)} · Boarding Laundry</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/">
      <span class="brand-mark" aria-hidden="true">SC</span>
      <span class="brand-text"><strong>Scarborough College</strong><span>Boarding Laundry Queue</span></span>
    </a>
    <nav class="nav">
      <a href="/">Queue</a>
      ${admin ? '<a href="/admin">Admin</a><form method="post" action="/admin/logout"><button class="link">Log out</button></form>' : '<a href="/admin">Staff</a>'}
    </nav>
  </div>
</header>
<main class="wrap">
${body}
</main>
<footer class="site-footer"><div class="wrap">Scarborough College Boarding · Laundry rota</div></footer>
</body>
</html>`;
}

function flash(msg, kind = 'ok') {
  return msg ? `<div class="flash flash-${kind}" role="status">${esc(msg)}</div>` : '';
}

function queueList(entries, { deviceId, highlight }) {
  if (!entries.length) return '<p class="empty">Nobody on the list yet.</p>';
  let pos = 0;
  return `<ol class="queue">${entries
    .map((e) => {
      const n = e.status === 'waiting' ? ++pos : null;
      const mine = deviceId && e.deviceId === deviceId;
      return `<li class="q-item q-${e.status}${mine ? ' q-mine' : ''}${e.id === highlight ? ' q-new' : ''}">
        <span class="q-pos">${n ?? (e.status === 'washing' ? '◉' : '✓')}</span>
        <span class="q-who"><strong>${esc(e.name)}</strong><small>${esc(e.house)}</small></span>
        <span class="badge badge-${e.status}">${STATUS_LABEL[e.status]}</span>
        ${mine && e.status === 'waiting'
          ? `<form method="post" action="/leave/${esc(e.id)}" onsubmit="return confirm('Take yourself off the list?')"><button class="btn btn-small btn-ghost">Leave</button></form>`
          : ''}
      </li>`;
    })
    .join('')}</ol>`;
}

function homePage({ today, tomorrow, todayList, tomorrowList, deviceId, msg, highlight }) {
  const waiting = todayList.filter((e) => e.status === 'waiting').length;
  return layout({
    title: 'Queue',
    refresh: 60,
    body: `
<section class="hero">
  <p class="eyebrow">Boarding House Laundry</p>
  <h1>Laundry queue</h1>
  <p class="lead">Scan the QR code on the laundry room door to put your name down for today or tomorrow.</p>
</section>
${flash(msg)}
<div class="stats">
  <div><span>${waiting}</span>waiting today</div>
  <div><span>${todayList.filter((e) => e.status === 'washing').length}</span>in the machine</div>
  <div><span>${tomorrowList.length}</span>signed up for tomorrow</div>
</div>
<div class="grid-2">
  <section class="card">
    <h2>Today <small>${prettyDate(today)}</small></h2>
    ${queueList(todayList, { deviceId, highlight })}
  </section>
  <section class="card">
    <h2>Tomorrow <small>${prettyDate(tomorrow)}</small></h2>
    ${queueList(tomorrowList, { deviceId, highlight })}
  </section>
</div>
<section class="card how">
  <h2>How it works</h2>
  <ol class="steps">
    <li><strong>Scan</strong> the QR code in the laundry room with your phone camera.</li>
    <li><strong>Add your name</strong> and house, and choose today or tomorrow.</li>
    <li><strong>Wait your turn</strong> — this page updates every minute. Boarding staff move the queue along.</li>
  </ol>
</section>`,
  });
}

function scanRequiredPage() {
  return layout({
    title: 'Scan to join',
    body: `
<section class="card narrow center">
  <div class="big-icon" aria-hidden="true">▣</div>
  <h1>Scan the QR code to sign up</h1>
  <p>To join the laundry queue, scan the QR code displayed in the boarding house laundry room with your phone's camera.</p>
  <p class="muted">If you scanned a while ago the code may have changed — please scan again.</p>
  <a class="btn" href="/">View the queue</a>
</section>`,
  });
}

function joinPage({ token, today, tomorrow, values = {}, error }) {
  const day = values.day || 'today';
  return layout({
    title: 'Join the queue',
    body: `
<section class="card narrow">
  <p class="eyebrow">You're in the laundry room</p>
  <h1>Join the queue</h1>
  ${flash(error, 'error')}
  <form method="post" action="/join" class="form">
    <input type="hidden" name="t" value="${esc(token)}">
    <label>Your name
      <input name="name" required maxlength="40" autocomplete="name" value="${esc(values.name)}" placeholder="e.g. Alex Smith">
    </label>
    <label>Boarding house / room
      <input name="house" required maxlength="40" value="${esc(values.house)}" placeholder="e.g. Ashville, room 12">
    </label>
    <fieldset class="days">
      <legend>When?</legend>
      <label class="choice"><input type="radio" name="day" value="today" ${day === 'today' ? 'checked' : ''}>
        <span><strong>Today</strong><small>${prettyDate(today)}</small></span></label>
      <label class="choice"><input type="radio" name="day" value="tomorrow" ${day === 'tomorrow' ? 'checked' : ''}>
        <span><strong>Tomorrow</strong><small>${prettyDate(tomorrow)}</small></span></label>
    </fieldset>
    <button class="btn btn-block">Add me to the list</button>
  </form>
</section>`,
  });
}

function loginPage({ error } = {}) {
  return layout({
    title: 'Staff login',
    body: `
<section class="card narrow">
  <p class="eyebrow">Boarding staff</p>
  <h1>Admin login</h1>
  ${flash(error, 'error')}
  <form method="post" action="/admin/login" class="form">
    <label>Password <input type="password" name="password" required autofocus autocomplete="current-password"></label>
    <button class="btn btn-block">Log in</button>
  </form>
</section>`,
  });
}

function adminTable(entries, date) {
  if (!entries.length) return '<p class="empty">No one signed up.</p>';
  const action = (id, label, path, cls = 'btn-ghost') =>
    `<form method="post" action="/admin/${path}/${esc(id)}"><button class="btn btn-small ${cls}">${label}</button></form>`;
  return `<div class="table-wrap"><table class="admin-table">
    <thead><tr><th>#</th><th>Name</th><th>House / room</th><th>Signed up</th><th>Status</th><th class="right">Actions</th></tr></thead>
    <tbody>${entries
      .map((e, i) => `<tr class="row-${e.status}">
        <td>${i + 1}</td>
        <td><strong>${esc(e.name)}</strong></td>
        <td>${esc(e.house)}</td>
        <td>${new Date(e.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}</td>
        <td><span class="badge badge-${e.status}">${STATUS_LABEL[e.status]}</span></td>
        <td class="actions">
          ${e.status === 'waiting' ? action(e.id, 'Start', 'start') : ''}
          ${e.status !== 'done' ? action(e.id, 'Done', 'done') : action(e.id, 'Undo', 'reset')}
          ${action(e.id, 'Remove', 'remove', 'btn-danger')}
        </td>
      </tr>`)
      .join('')}</tbody></table></div>
    <form method="post" action="/admin/clear/${date}" class="clear-form" onsubmit="return confirm('Remove everyone from this list?')">
      <button class="btn btn-small btn-danger">Clear whole list</button>
    </form>`;
}

function adminPage({ today, tomorrow, todayList, tomorrowList, qrSvg, joinUrl, msg }) {
  return layout({
    title: 'Admin',
    admin: true,
    body: `
<section class="hero">
  <p class="eyebrow">Boarding staff</p>
  <h1>Manage the laundry queue</h1>
</section>
${flash(msg)}
<section class="card">
  <h2>Today <small>${prettyDate(today)}</small></h2>
  ${adminTable(todayList, today)}
</section>
<section class="card">
  <h2>Tomorrow <small>${prettyDate(tomorrow)}</small></h2>
  ${adminTable(tomorrowList, tomorrow)}
</section>
<section class="card qr-card">
  <div class="qr">${qrSvg}</div>
  <div>
    <h2>Sign-up QR code</h2>
    <p>Print this and put it up in the laundry room. Students can only join the queue by scanning it.</p>
    <p class="muted small break">${esc(joinUrl)}</p>
    <div class="row">
      <a class="btn" href="/admin/poster" target="_blank">Print poster</a>
      <form method="post" action="/admin/rotate-qr" onsubmit="return confirm('Old QR codes (and photos of them) will stop working. You will need to print a new poster. Continue?')">
        <button class="btn btn-ghost">Generate new code</button>
      </form>
    </div>
  </div>
</section>`,
  });
}

function posterPage({ qrSvg }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Laundry queue poster</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css"></head>
<body class="poster">
  <div class="poster-inner">
    <p class="eyebrow">Scarborough College Boarding</p>
    <h1>Laundry queue</h1>
    <p class="lead">Scan to put your name down for today or tomorrow</p>
    <div class="poster-qr">${qrSvg}</div>
    <p>Open your phone camera and point it at the code.</p>
  </div>
  <script>window.onload = () => window.print();</script>
</body></html>`;
}

module.exports = { homePage, scanRequiredPage, joinPage, loginPage, adminPage, posterPage };
