/* Ajandam — servis çalışanı: çevrimdışı çalışma + bildirim tıklama */
"use strict";

const CACHE = "ajandam-v3";
const SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "css/style.css",
  "js/util.js", "js/db.js", "js/crypto.js", "js/notify.js",
  "js/calendar.js", "js/notes.js", "js/vault.js", "js/sync.js", "js/app.js",
  "icons/icon-192.png", "icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Uygulama dosyaları: önbellekten hızlı aç, arka planda güncelle.
   Firebase gibi dış istekler doğrudan ağa gider. */
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});

/* Bildirime tıklanınca uygulamayı öne getir */
self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      return self.clients.openWindow("./");
    })
  );
});
