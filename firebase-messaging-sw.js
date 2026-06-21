const CACHE_NAME = "ricardo-carol-pwa-v10";
const APP_SHELL = [
  "/",
  "/index.html",
  "/styles.css?v=10",
  "/app.js?v=10",
  "/manifest.json?v=10",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/apple-touch-icon.png"
];

const firebaseConfig = {
  apiKey: "AIzaSyCqOp8DRQQI4JZSzOnX_4yl3TrhxT4m6S0",
  authDomain: "ricardo-carol-app.firebaseapp.com",
  projectId: "ricardo-carol-app",
  storageBucket: "ricardo-carol-app.firebasestorage.app",
  messagingSenderId: "559158840335",
  appId: "1:559158840335:web:304ee3a5cd570912aca77a",
  measurementId: "G-PF1RSC4F1N"
};

let firebaseMessagingReady = false;

try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();
  firebaseMessagingReady = true;

  messaging.onBackgroundMessage(payload => {
    const notification = payload.notification || {};
    showRicardoCarolNotification({
      title: notification.title || "Ricardo & Carol",
      body: notification.body || "Nova atualização na app.",
      data: payload.data || {}
    });
  });
} catch (error) {
  console.warn("Firebase Messaging SW não carregou. Fallback Web Push ativo.", error);
}

function showRicardoCarolNotification({ title, body, data } = {}) {
  return self.registration.showNotification(title || "Ricardo & Carol", {
    body: body || "Nova atualização na app.",
    icon: "/assets/icon-192.png",
    badge: "/assets/icon-192.png",
    data: {
      url: "/#notificacoes",
      ...(data || {})
    }
  });
}

self.addEventListener("push", event => {
  if (firebaseMessagingReady) return;

  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "Nova atualização na app." };
  }

  const notification = payload.notification || payload.webpush?.notification || payload;
  event.waitUntil(showRicardoCarolNotification({
    title: notification.title || payload.title,
    body: notification.body || payload.body,
    data: payload.data || {}
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || "/";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(error => console.warn("Cache inicial não criado.", error))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request, { cache: "no-store" }).catch(() => caches.match("/index.html")));
    return;
  }

  const isVersionedAppFile = url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.endsWith("manifest.json");

  if (isVersionedAppFile) {
    event.respondWith(
      fetch(request, { cache: "no-store" }).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        return response;
      }).catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
      return response;
    }).catch(() => cached))
  );
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "CLEAR_APP_CACHE") {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))));
  }
});
