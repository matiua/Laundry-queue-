self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data.json(); } catch (e) { data = { title: 'Laundry queue', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Laundry queue', {
    body: data.body,
    tag: data.tag,
    renotify: true,
    requireInteraction: data.tag === 'turn',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [300, 150, 300],
    data: { url: '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    const open = wins.find((w) => new URL(w.url).pathname === '/');
    return open ? open.focus().then((w) => w.navigate('/')) : clients.openWindow('/');
  }));
});
