// Live updates, countdowns and "notify me" push sign-up. Works without it too.
(function () {
  // Reload when the queue changes so everyone sees the latest list.
  if (document.body.hasAttribute('data-live')) {
    let version = null;
    const check = () =>
      fetch('/api/version', { cache: 'no-store' })
        .then((r) => r.json())
        .then(({ v }) => {
          if (version !== null && v !== version) {
            // Drop one-off messages like "You're on the list!" from the URL.
            const url = new URL(location.href);
            url.searchParams.delete('m');
            url.searchParams.delete('id');
            location.replace(url);
          }
          version = v;
        })
        .catch(() => {});
    check();
    setInterval(check, 5000);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  }

  // mm:ss countdowns for "come within 10 minutes".
  const timers = document.querySelectorAll('[data-deadline]');
  if (timers.length) {
    const tick = () => timers.forEach((el) => {
      const left = Math.max(0, Number(el.dataset.deadline) - Date.now());
      const s = Math.ceil(left / 1000);
      el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      el.classList.toggle('urgent', s <= 120);
    });
    tick();
    setInterval(tick, 1000);
  }

  // "x min left" for the running wash, and the clock on the laundry room screen.
  const lefts = document.querySelectorAll('[data-left-for]');
  const clock = document.querySelector('[data-clock]');
  const tickSlow = () => {
    const now = Date.now();
    lefts.forEach((el) => {
      const left = Math.ceil((Number(el.dataset.leftFor) - now) / 60000);
      el.textContent = left > 0 ? `${left} min left` : 'Finishing up';
    });
    if (clock) clock.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  };
  if (lefts.length || clock) { tickSlow(); setInterval(tickSlow, 5000); }

  // Your turn: buzz the phone if the page is open.
  if (document.querySelector('.my-spot-called') && navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);

  // Push notifications.
  const btn = document.querySelector('[data-enable-push]');
  const on = document.querySelector('[data-push-on]');
  const iosHint = document.querySelector('[data-ios-hint]');
  if (!btn) return;
  const show = (el) => el && (el.hidden = false);
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  if (!supported) {
    if (isIos && !standalone) show(iosHint);
    return;
  }

  const b64ToBytes = (b64) => {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };

  const subscribe = async (reg) => {
    const { key } = await (await fetch('/api/push-key')).json();
    const sub = (await reg.pushManager.getSubscription())
      || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }));
    await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
  };

  navigator.serviceWorker.register('/sw.js').then(async (reg) => {
    if (Notification.permission === 'granted') {
      await subscribe(reg).catch(() => {}); // re-sync in case the server lost it
      show(on);
    } else if (Notification.permission === 'denied') {
      show(document.querySelector('[data-push-blocked]'));
    } else {
      show(btn);
    }
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        if ((await Notification.requestPermission()) !== 'granted') throw new Error('denied');
        await subscribe(reg);
        btn.hidden = true;
        show(on);
      } catch (e) {
        btn.hidden = true;
        show(document.querySelector('[data-push-blocked]'));
      }
    });
  });
})();
