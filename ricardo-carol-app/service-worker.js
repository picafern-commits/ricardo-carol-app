importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

const firebaseConfig = { apiKey:'AIzaSyCqOp8DRQQI4JZSzOnX_4yl3TrhxT4m6S0', authDomain:'ricardo-carol-app.firebaseapp.com', projectId:'ricardo-carol-app', storageBucket:'ricardo-carol-app.firebasestorage.app', messagingSenderId:'559158840335', appId:'1:559158840335:web:304ee3a5cd570912aca77a', measurementId:'G-PF1RSC4F1N' };
firebase.initializeApp(firebaseConfig);
try {
  const messaging = firebase.messaging();
  messaging.onBackgroundMessage(payload => {
    const title = payload.notification?.title || 'Ricardo & Carol';
    const options = { body: payload.notification?.body || 'Nova atualização na app.', icon: 'icon-192.png', badge: 'icon-192.png' };
    self.registration.showNotification(title, options);
  });
} catch(e) {}

const CACHE = 'ricardo-carol-v2';
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png']))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', event => { event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).catch(() => caches.match('./index.html')))); });
