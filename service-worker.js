const firebaseConfig = {
  apiKey: "AIzaSyCqOp8DRQQI4JZSzOnX_4yl3TrhxT4m6S0",
  authDomain: "ricardo-carol-app.firebaseapp.com",
  projectId: "ricardo-carol-app",
  storageBucket: "ricardo-carol-app.firebasestorage.app",
  messagingSenderId: "559158840335",
  appId: "1:559158840335:web:304ee3a5cd570912aca77a",
  measurementId: "G-PF1RSC4F1N"
};

try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage(payload => {
    self.registration.showNotification(payload.notification?.title || "Ricardo & Carol", {
      body: payload.notification?.body || "Nova atualização na app.",
      icon: "assets/icon-192.png",
      badge: "assets/icon-192.png"
    });
  });
} catch (error) {
  console.warn("Firebase Messaging ainda não está totalmente configurado.", error);
}

const CACHE_NAME = "ricardo-carol-pwa-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
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
    event.respondWith(fetch(request).catch(() => caches.match("./index.html")));
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
