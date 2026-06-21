importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCqOp8DRQQI4JZSzOnX_4yl3TrhxT4m6S0",
  authDomain: "ricardo-carol-app.firebaseapp.com",
  projectId: "ricardo-carol-app",
  storageBucket: "ricardo-carol-app.firebasestorage.app",
  messagingSenderId: "559158840335",
  appId: "1:559158840335:web:304ee3a5cd570912aca77a",
  measurementId: "G-PF1RSC4F1N"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Ricardo & Carol";
  const options = {
    body: payload.notification?.body || "Nova atualização na app.",
    icon: "/assets/icon-192.png",
    badge: "/assets/icon-192.png"
  };

  self.registration.showNotification(title, options);
});