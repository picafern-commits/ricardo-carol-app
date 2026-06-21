// Compatibilidade: a app agora usa /firebase-messaging-sw.js como Service Worker principal.
// Este ficheiro fica simples para não misturar cache PWA com Firebase Messaging.
self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});
