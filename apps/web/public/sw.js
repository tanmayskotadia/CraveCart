/* global self, clients */
self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data.json();
  } catch {
    return;
  }
  const href =
    typeof data.href === 'string' && /^\/(orders|seller|rider|notifications)(\/|$)/.test(data.href)
      ? data.href
      : '/notifications';
  event.waitUntil(
    self.registration.showNotification('CraveCart update', {
      body: 'Open your account to view your latest update.',
      tag: String(data.id ?? 'cravecart'),
      renotify: false,
      data: { href },
    }),
  );
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.href ?? '/notifications', self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === url.origin) {
          client.navigate(url.href);
          return client.focus();
        }
      }
      return clients.openWindow(url.href);
    }),
  );
});
