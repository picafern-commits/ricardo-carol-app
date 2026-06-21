import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore,
  enableIndexedDbPersistence,
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getMessaging,
  getToken,
  onMessage,
  isSupported
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyCqOp8DRQQI4JZSzOnX_4yl3TrhxT4m6S0",
  authDomain: "ricardo-carol-app.firebaseapp.com",
  projectId: "ricardo-carol-app",
  storageBucket: "ricardo-carol-app.firebasestorage.app",
  messagingSenderId: "559158840335",
  appId: "1:559158840335:web:304ee3a5cd570912aca77a",
  measurementId: "G-PF1RSC4F1N"
};

const VAPID_KEY = "BGjKSa4igTsspseVooRcCE4Fxl6bPzsgBb2Bi5zV-DDZxC8am9aEK9Ibtinlif16aA-t4x4tbwa7MnqkTpPXJEE";
const APP_VERSION = "12.0.0";
const PUSH_SERVICE_WORKER = "/firebase-messaging-sw.js";
const ROOM_ID = "principal";
const STORE = {
  settings: "rc_settings",
  items: "rc_items_cache",
  tasks: "rc_tasks_cache",
  logs: "rc_logs_cache",
  fcmToken: "rc_fcm_token"
};

const tabs = [
  { id: "dashboard", icon: "🏠", label: "Hoje", sub: "Resumo bonito das compras, tarefas e atividade." },
  { id: "compras", icon: "🛒", label: "Compras", sub: "Lista de supermercado partilhada em tempo real." },
  { id: "tarefas", icon: "✅", label: "Tarefas", sub: "Tarefas abertas com prioridade visual." },
  { id: "notificacoes", icon: "🔔", label: "Avisos", sub: "Notificações e histórico da casa." },
  { id: "configuracoes", icon: "⚙️", label: "Mais", sub: "Tema, perfil, atualizações e sincronização." }
];

const shoppingCategories = [
  { name: "Supermercado", icon: "🛒" },
  { name: "Frescos", icon: "🥦" },
  { name: "Laticínios", icon: "🥛" },
  { name: "Carne/Peixe", icon: "🥩" },
  { name: "Limpeza", icon: "🧼" },
  { name: "Casa", icon: "🏠" },
  { name: "Farmácia", icon: "💊" },
  { name: "Animais", icon: "🐾" },
  { name: "Outros", icon: "⭐" }
];

const priorities = {
  Baixa: { label: "Baixa", icon: "🌙" },
  Normal: { label: "Normal", icon: "✨" },
  Alta: { label: "Urgente", icon: "🔥" }
};

const defaultNotificationPrefs = {
  newShopping: true,
  newTasks: true,
  urgent: true,
  reminders: true,
  done: false
};

const defaultSettings = {
  darkMode: false,
  localNotifications: true,
  itemFilter: "Todas",
  taskFilter: "Todas",
  supermarketMode: false,
  profileName: "Ricardo",
  notificationPrefs: { ...defaultNotificationPrefs }
};

function hasValidVapidKey() {
  return VAPID_KEY && VAPID_KEY.length > 40 && !VAPID_KEY.includes("COLOCA_AQUI");
}


let db = null;
let auth = null;
let firebaseApp = null;
let messaging = null;
let serviceWorkerRegistrationPromise = null;
let lastFcmToken = localStorage.getItem(STORE.fcmToken) || "";
let uid = null;
let remoteReady = false;
let items = [];
let tasks = [];
let logs = [];
let unsubscribe = [];
let settings = { ...defaultSettings, ...readJson(STORE.settings, {}) };
settings.notificationPrefs = { ...defaultNotificationPrefs, ...(settings.notificationPrefs || {}) };

const $ = selector => document.querySelector(selector);

if (settings.darkMode) {
  document.documentElement.dataset.theme = "dark";
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function saveSettings() {
  saveJson(STORE.settings, settings);
}

function saveCaches() {
  saveJson(STORE.items, items);
  saveJson(STORE.tasks, tasks);
  saveJson(STORE.logs, logs.slice(0, 90));
}

function loadCaches() {
  items = readJson(STORE.items, []);
  tasks = readJson(STORE.tasks, []);
  logs = readJson(STORE.logs, []);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"]/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;"
  }[char]));
}

function formatDate(value) {
  if (!value) return "Agora";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "Agora";
  return date.toLocaleString("pt-PT", { dateStyle: "short", timeStyle: "short" });
}

function formatShortDateTime(value) {
  if (!value) return "Sem lembrete";
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem lembrete";
  return date.toLocaleString("pt-PT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function dateTimeLocalValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function reminderQuickValue(option) {
  const now = new Date();
  if (option === "1h") now.setHours(now.getHours() + 1);
  else if (option === "today18") now.setHours(18, 0, 0, 0);
  else if (option === "tomorrow9") {
    now.setDate(now.getDate() + 1);
    now.setHours(9, 0, 0, 0);
  } else if (option === "weekend10") {
    const day = now.getDay();
    const daysUntilSaturday = (6 - day + 7) % 7 || 7;
    now.setDate(now.getDate() + daysUntilSaturday);
    now.setHours(10, 0, 0, 0);
  }
  return dateTimeLocalValue(now);
}

function createdTime(entry) {
  const date = entry.createdAt?.toDate ? entry.createdAt.toDate() : new Date(entry.createdAt || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function sortByCreated(list) {
  return [...list].sort((a, b) => createdTime(b) - createdTime(a));
}

function setStatus(mode, text) {
  const className = mode === "online" ? "online" : mode === "waiting" ? "waiting" : "";
  $("#syncState").innerHTML = `<span class="status-dot ${className}"></span>${text}`;
}

function updateConnectionState() {
  if (!navigator.onLine) {
    setStatus("offline", "Offline, cache local ativo");
    return;
  }

  if (remoteReady) {
    setStatus("online", "Sincronizado online");
    return;
  }

  setStatus("waiting", "A preparar sincronização");
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2400);
}

function showUpdateScreen(title = "A atualizar a app", message = "Estamos a instalar a nova versão. Mantém a app aberta só uns segundos.") {
  const screen = $("#updateScreen");
  if (!screen) return;
  const titleElement = $("#updateTitle");
  const messageElement = $("#updateMessage");
  if (titleElement) titleElement.textContent = title;
  if (messageElement) messageElement.textContent = message;
  screen.classList.add("show");
  screen.setAttribute("aria-hidden", "false");
  document.body.classList.add("updating");
}

function hideUpdateScreen() {
  const screen = $("#updateScreen");
  if (!screen) return;
  screen.classList.remove("show");
  screen.setAttribute("aria-hidden", "true");
  document.body.classList.remove("updating");
}

function collectionPath(name) {
  return collection(db, "casal", ROOM_ID, name);
}

function documentPath(name, id) {
  return doc(db, "casal", ROOM_ID, name, id);
}

function upsertLocal(list, entry) {
  const index = list.findIndex(item => item.id === entry.id);
  if (index >= 0) list[index] = { ...list[index], ...entry };
  else list.unshift(entry);
}

function handleRemoteError(error) {
  console.warn(error);
  remoteReady = false;
  updateConnectionState();
  toast("Firebase indisponível. A app continua em modo local.");
}

async function writeEntry(collectionName, payload, localList) {
  const id = db ? doc(collectionPath(collectionName)).id : crypto.randomUUID();
  const localEntry = { ...payload, id, createdAt: new Date().toISOString() };
  upsertLocal(localList, localEntry);
  saveCaches();
  render();

  if (db) {
    try {
      await setDoc(documentPath(collectionName, id), { ...payload, createdAt: serverTimestamp() });
    } catch (error) {
      handleRemoteError(error);
    }
  }

  return localEntry;
}

async function patchEntry(collectionName, id, patch, localList) {
  const entry = localList.find(item => item.id === id);
  if (entry) Object.assign(entry, patch);
  saveCaches();
  render();

  if (db) {
    try {
      await updateDoc(documentPath(collectionName, id), patch);
    } catch (error) {
      handleRemoteError(error);
    }
  }
}

async function removeEntry(collectionName, id, localList) {
  const index = localList.findIndex(item => item.id === id);
  if (index >= 0) localList.splice(index, 1);
  saveCaches();
  render();

  if (db) {
    try {
      await deleteDoc(documentPath(collectionName, id));
    } catch (error) {
      handleRemoteError(error);
    }
  }
}

async function addLog(text, type = "info") {
  await writeEntry("logs", { text, type }, logs);
  logs = sortByCreated(logs).slice(0, 90);
  saveCaches();
  render();
}

function showLocalNotification(title, body) {
  if (!settings.localNotifications) return;
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "assets/icon-192.png" });
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImage(file) {
  if (!file) return "";
  if (!file.type.startsWith("image/")) {
    toast("Escolhe uma imagem válida.");
    return "";
  }

  const source = await fileToDataUrl(file);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = source;
  });

  const maxSide = 860;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

async function testLocalNotification() {
  if (!("Notification" in window)) {
    toast("Este dispositivo não suporta notificações.");
    return;
  }
  if (Notification.permission !== "granted") {
    await enableNotifications();
    return;
  }
  showLocalNotification("Ricardo & Carol", "Teste de notificação neste dispositivo.");
  toast("Notificação de teste enviada.");
}

async function initFirebase() {
  try {
    firebaseApp = initializeApp(firebaseConfig);
    db = getFirestore(firebaseApp);
    await enableIndexedDbPersistence(db).catch(error => {
      console.info("Persistência local do Firestore não ativada:", error?.code || error);
    });

    auth = getAuth(firebaseApp);
    await signInAnonymously(auth);
    onAuthStateChanged(auth, user => {
      uid = user?.uid || null;
      $("#userState").textContent = uid ? `Online: ${uid.slice(0, 6)}` : "Sessão anónima";
    });

    listenToFirestore();
    remoteReady = true;
    updateConnectionState();
  } catch (error) {
    db = null;
    handleRemoteError(error);
  }
}

function listenToFirestore() {
  unsubscribe.forEach(stop => stop());
  unsubscribe = [];

  bindCollection("compras", data => {
    items = data;
  });
  bindCollection("tarefas", data => {
    tasks = data;
  });
  bindCollection("logs", data => {
    logs = data.slice(0, 90);
  });
}

function bindCollection(name, assign) {
  const q = query(collectionPath(name), orderBy("createdAt", "desc"));
  const stop = onSnapshot(q, snapshot => {
    assign(snapshot.docs.map(entry => ({ id: entry.id, ...entry.data() })));
    remoteReady = true;
    updateConnectionState();
    saveCaches();
    render();
  }, handleRemoteError);
  unsubscribe.push(stop);
}

function renderNavigation() {
  const navHtml = tabs.map(tab => navButton(tab)).join("");
  $("#desktopNav").innerHTML = navHtml;
  $("#mobileNav").innerHTML = navHtml;
}

function navButton(tab) {
  return `
    <button class="nav-button ${tab.id === "dashboard" ? "active" : ""}" type="button" data-tab="${tab.id}">
      <span class="nav-icon">${tab.icon}</span>
      <span>${tab.label}</span>
    </button>
  `;
}

function goTo(pageId) {
  const tab = tabs.find(item => item.id === pageId) || tabs[0];
  document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", page.id === tab.id));
  document.querySelectorAll("[data-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === tab.id);
  });
  $("#pageTitle").textContent = tab.label;
  $("#pageSub").textContent = tab.sub;
  if (location.hash !== `#${tab.id}`) {
    history.replaceState(null, "", `#${tab.id}`);
  }
  render();
}

async function addItem(event) {
  event.preventDefault();
  const name = $("#itemName").value.trim();
  if (!name) {
    toast("Escreve o produto.");
    return;
  }

  const photoFile = $("#itemPhoto")?.files?.[0];
  const photoData = photoFile ? await compressImage(photoFile) : "";
  const urgent = Boolean($("#itemUrgent")?.checked);

  const item = {
    name,
    qty: $("#itemQty").value.trim() || "1",
    category: $("#itemCategory").value,
    status: "pending",
    urgent,
    photoData,
    by: uid || "local",
    byName: settings.profileName || "Ricardo"
  };

  $("#itemName").value = "";
  $("#itemQty").value = "";
  if ($("#itemPhoto")) $("#itemPhoto").value = "";
  if ($("#itemUrgent")) $("#itemUrgent").checked = false;
  await writeEntry("compras", item, items);
  await addLog(`${urgent ? "Produto urgente" : "Produto adicionado"}: ${name}`, "shop");
  showLocalNotification(urgent ? "Compra urgente" : "Novo produto", name);
}

async function toggleItem(id) {
  const item = items.find(entry => entry.id === id);
  if (!item) return;
  const done = item.status !== "done";
  await patchEntry("compras", id, {
    status: done ? "done" : "pending",
    doneAt: done ? new Date().toISOString() : null,
    completedByName: done ? settings.profileName : null,
    updatedByName: settings.profileName
  }, items);
  await addLog(`${done ? "Comprado" : "Reaberto"}: ${item.name}`, "shop");
}

async function toggleUrgentItem(id) {
  const item = items.find(entry => entry.id === id);
  if (!item) return;
  const urgent = !item.urgent;
  await patchEntry("compras", id, { urgent, updatedByName: settings.profileName }, items);
  await addLog(`${urgent ? "Marcado urgente" : "Retirado urgente"}: ${item.name}`, "shop");
}

async function deleteItem(id) {
  await removeEntry("compras", id, items);
}

async function addTask(event) {
  event.preventDefault();
  const title = $("#taskTitle").value.trim();
  if (!title) {
    toast("Escreve a tarefa.");
    return;
  }

  const reminderValue = $("#taskReminder")?.value || "";
  const priority = $("#taskPriority").value;
  const task = {
    title,
    due: $("#taskDue").value,
    priority,
    status: "pending",
    reminderAt: reminderValue ? new Date(reminderValue).toISOString() : null,
    reminderLabel: reminderValue ? formatShortDateTime(new Date(reminderValue)) : "Sem lembrete",
    reminderSent: false,
    by: uid || "local",
    byName: settings.profileName || "Ricardo"
  };

  $("#taskTitle").value = "";
  if ($("#taskReminder")) $("#taskReminder").value = "";
  await writeEntry("tarefas", task, tasks);
  await addLog(`${priority === "Alta" ? "Tarefa urgente" : "Tarefa criada"}: ${title}`, "task");
  showLocalNotification(priority === "Alta" ? "Tarefa urgente" : "Nova tarefa", title);
}

async function toggleTask(id) {
  const task = tasks.find(entry => entry.id === id);
  if (!task) return;
  const done = task.status !== "done";
  await patchEntry("tarefas", id, {
    status: done ? "done" : "pending",
    doneAt: done ? new Date().toISOString() : null,
    completedByName: done ? settings.profileName : null,
    updatedByName: settings.profileName
  }, tasks);
  await addLog(`${done ? "Tarefa concluída" : "Tarefa reaberta"}: ${task.title}`, "task");
}

async function toggleUrgentTask(id) {
  const task = tasks.find(entry => entry.id === id);
  if (!task) return;
  const urgent = task.priority !== "Alta";
  await patchEntry("tarefas", id, { priority: urgent ? "Alta" : "Normal", updatedByName: settings.profileName }, tasks);
  await addLog(`${urgent ? "Tarefa marcada urgente" : "Tarefa voltou a normal"}: ${task.title}`, "task");
}

async function deleteTask(id) {
  await removeEntry("tarefas", id, tasks);
}

function clearDone() {
  items.filter(item => item.status === "done").forEach(item => removeEntry("compras", item.id, items));
  tasks.filter(task => task.status === "done").forEach(task => removeEntry("tarefas", task.id, tasks));
  toast("Concluídos limpos.");
}

function setItemFilter(value) {
  settings.itemFilter = value;
  saveSettings();
  render();
}

function setTaskFilter(value) {
  settings.taskFilter = value;
  saveSettings();
  render();
}

function setProfileName(value) {
  settings.profileName = value;
  saveSettings();
  syncTokenPreferences();
  toast(`Dispositivo definido como ${value}.`);
  render();
}

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

async function waitForServiceWorkerActivation(registration) {
  const worker = registration.installing || registration.waiting || registration.active;
  if (!worker || worker.state === "activated") return registration;

  if (registration.waiting) {
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
  }

  await new Promise(resolve => {
    worker.addEventListener("statechange", () => {
      if (worker.state === "activated") resolve();
    });
  });

  return registration;
}

async function getServiceWorkerRegistration() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service Worker não suportado neste navegador.");
  }

  if (!serviceWorkerRegistrationPromise) {
    serviceWorkerRegistrationPromise = navigator.serviceWorker.register(PUSH_SERVICE_WORKER, {
      scope: "/"
    }).then(async registration => {
      await waitForServiceWorkerActivation(registration);
      await navigator.serviceWorker.ready;
      return registration;
    });
  }

  return serviceWorkerRegistrationPromise;
}

function shortToken(token = "") {
  if (!token) return "Ainda sem token neste dispositivo.";
  return `${token.slice(0, 18)}...${token.slice(-12)}`;
}

async function copyFcmToken() {
  if (!lastFcmToken) {
    toast("Ainda não há token. Carrega primeiro em Ativar neste dispositivo.");
    return;
  }

  try {
    await navigator.clipboard.writeText(lastFcmToken);
    toast("Token FCM copiado.");
  } catch {
    toast("Não consegui copiar automaticamente. Abre o Firestore e copia o token.");
  }
}

async function enableNotifications() {
  if (!("Notification" in window)) {
    toast("Este dispositivo não suporta notificações.");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    toast("Notificações recusadas.");
    return;
  }

  settings.localNotifications = true;
  saveSettings();
  showLocalNotification("Ricardo & Carol", "Notificações ativas neste dispositivo.");
  toast("Notificações ativas.");

  try {
    if (!hasValidVapidKey()) {
      toast("Falta a VAPID_KEY no app.js.");
      return;
    }
    if (!db) {
      toast("Firebase ainda não ligou. Tenta novamente em alguns segundos.");
      return;
    }
    if (!(await isSupported())) {
      toast("Firebase Push não é suportado neste dispositivo/navegador.");
      return;
    }

    const registration = await getServiceWorkerRegistration();
    messaging = getMessaging(firebaseApp);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });

    if (!token) {
      toast("Não foi possível criar token FCM neste dispositivo.");
      return;
    }

    lastFcmToken = token;
    localStorage.setItem(STORE.fcmToken, token);

    await setDoc(documentPath("tokens", token), {
      token,
      uid: uid || null,
      userAgent: navigator.userAgent,
      standalone: isStandaloneApp(),
      sw: PUSH_SERVICE_WORKER,
      appVersion: APP_VERSION,
      profileName: settings.profileName || "Ricardo",
      notificationPrefs: settings.notificationPrefs || defaultNotificationPrefs,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    }, { merge: true });

    onMessage(messaging, payload => {
      showLocalNotification(
        payload.notification?.title || "Ricardo & Carol",
        payload.notification?.body || "Nova atualização"
      );
    });

    toast("Push ativo. Token FCM guardado.");
  } catch (error) {
    console.warn("Firebase Messaging ainda não está totalmente configurado.", error);
    toast(`Erro no Firebase Push: ${error?.code || error?.message || "ver consola"}`);
  }

  render();
}

async function syncTokenPreferences() {
  if (!db || !lastFcmToken) return;
  try {
    await setDoc(documentPath("tokens", lastFcmToken), {
      token: lastFcmToken,
      profileName: settings.profileName || "Ricardo",
      notificationPrefs: settings.notificationPrefs || defaultNotificationPrefs,
      appVersion: APP_VERSION,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch (error) {
    console.warn("Não consegui atualizar preferências do token.", error);
  }
}

function toggleNotificationPref(pref) {
  settings.notificationPrefs = { ...defaultNotificationPrefs, ...(settings.notificationPrefs || {}) };
  settings.notificationPrefs[pref] = !settings.notificationPrefs[pref];
  saveSettings();
  syncTokenPreferences();
  render();
}

function toggleSupermarketMode() {
  settings.supermarketMode = !settings.supermarketMode;
  saveSettings();
  toast(settings.supermarketMode ? "Chegaste ao supermercado. Modo rápido ativo." : "Modo normal ativo.");
  render();
}

function enterStoreMode() {
  settings.supermarketMode = true;
  saveSettings();
  goTo("compras");
  toast("Modo supermercado ativo.");
}

function toggleDarkMode() {
  settings.darkMode = !settings.darkMode;
  document.documentElement.dataset.theme = settings.darkMode ? "dark" : "";
  saveSettings();
  render();
}

function toggleLocalNotifications() {
  settings.localNotifications = !settings.localNotifications;
  saveSettings();
  render();
}

function exportData() {
  const data = {
    exportedAt: new Date().toISOString(),
    items,
    tasks,
    logs,
    settings
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "ricardo-carol-backup.json";
  link.click();
  URL.revokeObjectURL(url);
}

function clearLocalData() {
  if (!confirm("Limpar os dados guardados neste dispositivo?")) return;
  localStorage.removeItem(STORE.items);
  localStorage.removeItem(STORE.tasks);
  localStorage.removeItem(STORE.logs);
  items = [];
  tasks = [];
  logs = [];
  render();
  toast("Dados locais limpos.");
}

function syncNow() {
  updateConnectionState();
  toast(db && remoteReady ? "Sincronizado com Firebase." : "Modo local ativo.");
}

function quickAdd() {
  goTo("compras");
  window.setTimeout(() => $("#itemName")?.focus(), 80);
}

function categoryInfo(category = "Outros") {
  return shoppingCategories.find(item => item.name === category) || shoppingCategories.at(-1);
}

function profileAvatar(name = "Ricardo") {
  const clean = String(name || "?").trim();
  const initial = clean.slice(0, 1).toUpperCase() || "?";
  const cssName = clean.toLowerCase().includes("carol") ? "carol" : "ricardo";
  return `<span class="avatar ${cssName}" title="${escapeHtml(clean)}">${escapeHtml(initial)}</span>`;
}

function byLine(entry) {
  return `${profileAvatar(entry.byName)}<span>${escapeHtml(entry.byName || "Ricardo")}</span>`;
}

function doneItems() {
  return sortByCreated(items.filter(item => item.status === "done"));
}

function pendingItems() {
  return sortByCreated(items.filter(item => item.status !== "done"));
}

function pendingTasks() {
  return sortByCreated(tasks.filter(task => task.status !== "done"));
}

function doneTasks() {
  return sortByCreated(tasks.filter(task => task.status === "done"));
}

function visibleItems() {
  const pending = pendingItems();
  if (settings.itemFilter === "Todas") return pending;
  return pending.filter(item => (item.category || "Outros") === settings.itemFilter);
}

function visibleTasks() {
  const pending = pendingTasks();
  if (settings.taskFilter === "Todas") return pending;
  return pending.filter(task => task.priority === settings.taskFilter || task.due === settings.taskFilter);
}

function itemHtml(item, options = {}) {
  const category = categoryInfo(item.category);
  const isDone = item.status === "done";
  const supermarketClass = options.supermarket ? " supermarket-card tap-to-check" : "";
  const photo = item.photoData ? `<img class="product-photo" src="${item.photoData}" alt="Foto de ${escapeHtml(item.name)}">` : `<span class="photo-placeholder">${category.icon}</span>`;
  const urgentChip = item.urgent ? `<span class="urgent-chip">🔥 Urgente</span>` : "";
  const cardAction = options.supermarket ? `data-action="toggle-item" data-id="${item.id}"` : "";
  return `
    <div class="list-item shopping-item${supermarketClass} ${item.urgent ? "is-urgent" : ""} ${isDone ? "done" : ""}" ${cardAction}>
      <button class="check-button" type="button" data-action="toggle-item" data-id="${item.id}" aria-label="Alternar produto">✓</button>
      <div class="product-thumb">${photo}</div>
      <div class="item-main">
        <div class="item-name"><span class="category-emoji">${category.icon}</span>${escapeHtml(item.name)} ${urgentChip}</div>
        <div class="item-meta rich-meta">
          <span class="qty-badge">Qtd: ${escapeHtml(item.qty || "1")}</span>
          <span class="category-chip">${category.icon} ${escapeHtml(category.name)}</span>
          <span class="by-chip">${byLine(item)}</span>
          ${item.completedByName ? `<span class="done-chip">feito por ${escapeHtml(item.completedByName)}</span>` : ""}
        </div>
      </div>
      <div class="card-actions">
        <button class="mini-button ${item.urgent ? "active" : ""}" type="button" data-action="toggle-urgent-item" data-id="${item.id}" aria-label="Marcar urgente">🔥</button>
        <button class="icon-button" type="button" data-action="delete-item" data-id="${item.id}" aria-label="Apagar produto">×</button>
      </div>
    </div>
  `;
}

function taskHtml(task) {
  const priorityKey = task.priority || "Normal";
  const priority = priorities[priorityKey] || priorities.Normal;
  const reminderChip = task.reminderAt ? `<span class="reminder-chip">⏰ ${formatShortDateTime(task.reminderAt)}</span>` : "";
  return `
    <div class="list-item task-item priority-${priorityKey.toLowerCase()} ${priorityKey === "Alta" ? "is-urgent" : ""} ${task.status === "done" ? "done" : ""}">
      <button class="check-button" type="button" data-action="toggle-task" data-id="${task.id}" aria-label="Alternar tarefa">✓</button>
      <div class="item-main">
        <div class="item-name">${escapeHtml(task.title)} ${priorityKey === "Alta" ? `<span class="urgent-chip">🔥 Urgente</span>` : ""}</div>
        <div class="item-meta rich-meta">
          <span class="priority-chip priority-${priorityKey.toLowerCase()}">${priority.icon} ${priority.label}</span>
          <span class="due-chip">📅 ${escapeHtml(task.due || "Sem data")}</span>
          ${reminderChip}
          <span class="by-chip">${byLine(task)}</span>
          ${task.completedByName ? `<span class="done-chip">feito por ${escapeHtml(task.completedByName)}</span>` : ""}
        </div>
      </div>
      <div class="card-actions">
        <button class="mini-button ${priorityKey === "Alta" ? "active" : ""}" type="button" data-action="toggle-urgent-task" data-id="${task.id}" aria-label="Marcar urgente">🔥</button>
        <button class="icon-button" type="button" data-action="delete-task" data-id="${task.id}" aria-label="Apagar tarefa">×</button>
      </div>
    </div>
  `;
}

function nextReminderTask() {
  const now = Date.now();
  return pendingTasks()
    .filter(task => task.reminderAt && new Date(task.reminderAt).getTime() >= now)
    .sort((a, b) => new Date(a.reminderAt).getTime() - new Date(b.reminderAt).getTime())[0];
}

function categorySummary() {
  const grouped = new Map();
  pendingItems().forEach(item => {
    const info = categoryInfo(item.category);
    grouped.set(info.name, { ...info, count: (grouped.get(info.name)?.count || 0) + 1 });
  });
  return [...grouped.values()].sort((a, b) => b.count - a.count).slice(0, 4);
}

function mentalWidgetHtml() {
  const urgentShopping = pendingItems().filter(item => item.urgent).length;
  const urgentTasks = pendingTasks().filter(task => task.priority === "Alta").length;
  const reminder = nextReminderTask();
  const categories = categorySummary();
  const lastBy = logs[0]?.text || "Nada novo por agora";
  return `
    <div class="panel span-12 mental-widget">
      <div class="section-title">
        <h2>🧠 Mental da casa</h2>
        <button class="button primary" type="button" data-action="enter-store-mode">Cheguei ao supermercado</button>
      </div>
      <div class="mental-grid">
        <div class="mental-card"><b>${urgentShopping + urgentTasks}</b><span>urgentes agora</span></div>
        <div class="mental-card"><b>${reminder ? formatShortDateTime(reminder.reminderAt) : "Livre"}</b><span>${reminder ? escapeHtml(reminder.title) : "sem lembretes"}</span></div>
        <div class="mental-card"><b>${categories.map(cat => `${cat.icon} ${cat.count}`).join(" · ") || "🛒 0"}</b><span>categorias em falta</span></div>
        <div class="mental-card"><b>Último</b><span>${escapeHtml(lastBy)}</span></div>
      </div>
    </div>
  `;
}

function renderDashboard() {
  const pItems = pendingItems();
  const pTasks = pendingTasks();
  const urgentTasks = pTasks.filter(task => task.priority === "Alta").length;
  const lastLog = logs[0];

  $("#dashboard").innerHTML = `
    <div class="hero-card panel span-12">
      <div>
        <p class="eyebrow">Casa organizada</p>
        <h2>Olá, ${escapeHtml(settings.profileName)} ✨</h2>
        <p>Hoje têm <b>${pItems.length}</b> compras por fazer e <b>${pTasks.length}</b> tarefas abertas.</p>
      </div>
      <div class="hero-actions">
        <button class="button primary" type="button" data-go="compras">Ir às compras</button>
        <button class="button secondary" type="button" data-go="tarefas">Ver tarefas</button>
      </div>
    </div>
    <div class="grid">
      ${mentalWidgetHtml()}
      <div class="panel span-4 kpi"><div><b>${pItems.length}</b><span>Compras pendentes</span></div><span class="pill">🛒 Lista</span></div>
      <div class="panel span-4 kpi"><div><b>${pTasks.length}</b><span>Tarefas abertas</span></div><span class="pill accent">${urgentTasks} urgentes</span></div>
      <div class="panel span-4 kpi"><div><b>${logs.length}</b><span>Atividades</span></div><span class="pill">${navigator.onLine ? "Online" : "Offline"}</span></div>
      <div class="panel span-6">
        <div class="section-title"><h2>Próximas compras</h2><button class="button secondary" type="button" data-go="compras">Abrir</button></div>
        <div class="list">${pItems.slice(0, 5).map(item => itemHtml(item)).join("") || empty("Lista limpa", "Adiciona o primeiro produto para a próxima ida ao supermercado.", "🛒")}</div>
      </div>
      <div class="panel span-6">
        <div class="section-title"><h2>Próximas tarefas</h2><button class="button secondary" type="button" data-go="tarefas">Abrir</button></div>
        <div class="list">${pTasks.slice(0, 5).map(taskHtml).join("") || empty("Tudo tratado", "Sem tarefas pendentes por agora.", "✅")}</div>
      </div>
      <div class="panel span-12 activity-strip">
        <span class="pill">Última atividade</span>
        <strong>${lastLog ? escapeHtml(lastLog.text) : "Ainda sem atividade."}</strong>
        <small>${lastLog ? formatDate(lastLog.createdAt) : "Quando adicionarem algo, aparece aqui."}</small>
      </div>
    </div>
  `;
}

function renderShopping() {
  const pending = pendingItems();
  const done = doneItems();
  const total = pending.length + done.length;
  const progress = total ? Math.round((done.length / total) * 100) : 0;
  const categories = ["Todas", ...shoppingCategories.map(item => item.name)];
  const modeLabel = settings.supermarketMode ? "Sair do supermercado" : "Cheguei ao supermercado";

  $("#compras").innerHTML = `
    <div class="panel shopping-panel ${settings.supermarketMode ? "is-supermarket" : ""}">
      <div class="section-title">
        <h2>${settings.supermarketMode ? "🛒 Cheguei ao supermercado" : "Adicionar produto"}</h2>
        <span class="pill">${pending.length} por comprar</span>
      </div>
      ${settings.supermarketMode ? `
        <div class="store-mode-hero">
          <div><b>${progress}% tratado</b><span>Toca no produto para marcar como comprado.</span></div>
          <button class="button secondary" type="button" data-action="toggle-supermarket-mode">Sair</button>
        </div>
      ` : `
        <form class="form shopping-form" id="itemForm">
          <input class="input" id="itemName" placeholder="Produto" autocomplete="off">
          <input class="input" id="itemQty" placeholder="Qtd" autocomplete="off">
          <select id="itemCategory">${shoppingCategories.map(cat => optionHtml(cat.name)).join("")}</select>
          <button class="button primary" type="submit">Adicionar</button>
          <label class="file-picker">📷 Foto<input id="itemPhoto" type="file" accept="image/*" capture="environment"></label>
          <label class="check-label"><input id="itemUrgent" type="checkbox"> 🔥 Urgente</label>
        </form>
      `}
      <div class="toolbar shopping-toolbar">
        <select data-setting="itemFilter" aria-label="Filtrar compras">${categories.map(value => optionHtml(value, settings.itemFilter)).join("")}</select>
        <button class="button secondary supermarket-toggle ${settings.supermarketMode ? "active" : ""}" type="button" data-action="toggle-supermarket-mode">🛒 ${modeLabel}</button>
        <button class="button secondary" type="button" data-action="clear-done">Limpar concluídos</button>
      </div>
      <div class="category-strip">${shoppingCategories.map(cat => `<button class="category-pill ${settings.itemFilter === cat.name ? "active" : ""}" type="button" data-filter-category="${escapeHtml(cat.name)}">${cat.icon}<span>${escapeHtml(cat.name)}</span></button>`).join("")}</div>
      <div class="list ${settings.supermarketMode ? "supermarket-list" : ""}">${visibleItems().map(item => itemHtml(item, { supermarket: settings.supermarketMode })).join("") || empty(settings.supermarketMode ? "Tudo comprado" : "Lista limpa", settings.supermarketMode ? "A lista de supermercado está limpa por agora." : "Adiciona o primeiro produto para a próxima ida ao supermercado.", "🛒")}</div>
    </div>
    ${settings.supermarketMode ? "" : `
      <div class="panel">
        <div class="section-title"><h2>Comprados</h2><span class="pill">${done.length}</span></div>
        <div class="list">${done.map(item => itemHtml(item)).join("") || empty("Ainda nada comprado", "Quando marcares produtos, eles aparecem aqui riscados.", "✨")}</div>
      </div>
    `}
  `;

  $("#itemForm")?.addEventListener("submit", addItem);
}

function renderTasks() {
  const pending = pendingTasks();
  const done = doneTasks();
  const filters = ["Todas", "Alta", "Normal", "Baixa", "Hoje", "Amanhã", "Esta semana", "Sem data"];

  $("#tarefas").innerHTML = `
    <div class="panel">
      <div class="section-title"><h2>Adicionar tarefa</h2><span class="pill">${pending.length} abertas</span></div>
      <form class="form tasks task-form" id="taskForm">
        <input class="input" id="taskTitle" placeholder="Tarefa" autocomplete="off">
        <select id="taskDue">${["Hoje", "Amanhã", "Esta semana", "Sem data"].map(optionHtml).join("")}</select>
        <select id="taskPriority">${["Normal", "Alta", "Baixa"].map(optionHtml).join("")}</select>
        <input class="input" id="taskReminder" type="datetime-local" aria-label="Lembrete">
        <button class="button primary" type="submit">Adicionar</button>
      </form>
      <div class="quick-reminders">
        <button class="chip-button" type="button" data-reminder="1h">⏰ 1h</button>
        <button class="chip-button" type="button" data-reminder="today18">Hoje 18h</button>
        <button class="chip-button" type="button" data-reminder="tomorrow9">Amanhã 9h</button>
        <button class="chip-button" type="button" data-reminder="weekend10">Sábado 10h</button>
      </div>
      <div class="toolbar">
        <select data-setting="taskFilter" aria-label="Filtrar tarefas">${filters.map(value => optionHtml(value, settings.taskFilter)).join("")}</select>
        <button class="button secondary" type="button" data-action="clear-done">Limpar concluídos</button>
        <button class="button secondary" type="button" data-action="export">Exportar</button>
      </div>
      <div class="priority-guide">
        <span class="priority-chip priority-baixa">🌙 Baixa</span>
        <span class="priority-chip priority-normal">✨ Normal</span>
        <span class="priority-chip priority-alta">🔥 Urgente</span>
        <span class="reminder-chip">⏰ Lembrete por data/hora</span>
      </div>
      <div class="list">${visibleTasks().map(taskHtml).join("") || empty("Tudo tratado", "Sem tarefas pendentes por agora.", "✅")}</div>
    </div>
    <div class="panel">
      <div class="section-title"><h2>Concluídas</h2><span class="pill">${done.length}</span></div>
      <div class="list">${done.map(taskHtml).join("") || empty("Ainda sem concluídas", "As tarefas terminadas aparecem aqui.", "🏁")}</div>
    </div>
  `;

  $("#taskForm").addEventListener("submit", addTask);
}

function renderNotifications() {
  const permission = "Notification" in window ? Notification.permission : "não suportado";
  const pushReady = hasValidVapidKey();
  const standalone = isStandaloneApp() ? "Sim" : "Não";
  const tokenText = shortToken(lastFcmToken);
  const prefs = { ...defaultNotificationPrefs, ...(settings.notificationPrefs || {}) };
  const prefRows = [
    ["newShopping", "🛒 Novas compras", "Quando alguém adiciona produto."],
    ["newTasks", "✅ Novas tarefas", "Quando alguém cria uma tarefa."],
    ["urgent", "🔥 Urgentes", "Avisos com prioridade alta."],
    ["reminders", "⏰ Lembretes", "Tarefas com data e hora."],
    ["done", "🏁 Concluídos", "Quando algo é marcado como feito."]
  ];

  $("#notificacoes").innerHTML = `
    <div class="panel">
      <div class="section-title"><h2>Notificações</h2><button class="button primary" type="button" data-action="enable-notifications">Ativar neste dispositivo</button></div>
      <div class="settings-row">
        <div><b>Alertas locais</b><small>Estado atual: ${settings.localNotifications ? "ligados" : "desligados"}. Permissão: ${permission}.</small></div>
        <button class="toggle ${settings.localNotifications ? "on" : ""}" type="button" data-action="toggle-local-notifications" aria-label="Alternar notificações locais"></button>
      </div>
      <div class="settings-row">
        <div><b>Firebase Push</b><small>${pushReady ? "VAPID configurada. Push automático ativo para compras, tarefas, urgentes e lembretes." : "A aguardar VAPID_KEY do Firebase."}</small></div>
        <button class="button secondary" type="button" data-action="test-notification">Testar local</button>
      </div>
      <div class="settings-row">
        <div><b>Token FCM</b><small>${tokenText}</small></div>
        <button class="button secondary" type="button" data-action="copy-token">Copiar token</button>
      </div>
      <div class="notification-prefs">
        ${prefRows.map(([key, title, text]) => `
          <div class="settings-row compact">
            <div><b>${title}</b><small>${text}</small></div>
            <button class="toggle ${prefs[key] ? "on" : ""}" type="button" data-action="toggle-notification-pref" data-pref="${key}" aria-label="Alternar ${title}"></button>
          </div>
        `).join("")}
      </div>
      <p class="note">Instalada como app: <b>${standalone}</b> · Utilizador: <b>${escapeHtml(settings.profileName)}</b> · Versão: <b>${APP_VERSION}</b><br>No iPhone, abre sempre pelo ícone. As próximas atualizações entram automaticamente, sem voltar ao Safari.</p>
    </div>
    <div class="panel">
      <h2>Histórico</h2>
      <div class="list">${logs.map(logHtml).join("") || empty("Sem atividade.")}</div>
    </div>
  `;
}

function renderSettings() {
  $("#configuracoes").innerHTML = `
    <div class="panel">
      <h2>Configurações</h2>
      <div class="settings-row">
        <div><b>Quem está a usar</b><small>Usado para enviar notificações só para a outra pessoa.</small></div>
        <select data-setting="profileName" aria-label="Quem está a usar">${["Ricardo", "Carol"].map(value => optionHtml(value, settings.profileName)).join("")}</select>
      </div>
      <div class="settings-row">
        <div><b>Dark mode</b><small>Estado atual: ${settings.darkMode ? "ativo" : "inativo"}.</small></div>
        <button class="toggle ${settings.darkMode ? "on" : ""}" type="button" data-action="toggle-dark" aria-label="Alternar dark mode"></button>
      </div>
      <div class="settings-row">
        <div><b>Atualizações da app</b><small>Versão ${APP_VERSION}. Quando houver atualização, aparece um ecrã de loading e a app abre a nova versão sozinha.</small></div>
        <button class="button secondary" type="button" data-action="force-update">Atualizar agora</button>
      </div>
      <div class="settings-row">
        <div><b>Dados locais</b><small>${items.length} compras, ${tasks.length} tarefas e ${logs.length} registos guardados neste dispositivo.</small></div>
        <button class="button secondary" type="button" data-action="clear-local">Limpar</button>
      </div>
    </div>
    <div class="panel">
      <h2>Firebase</h2>
      <p class="note">Projeto: <b>ricardo-carol-app</b><br>Base de dados: <b>casal / ${ROOM_ID}</b></p>
      <div class="row-actions"><button class="button secondary" type="button" data-action="sync">Testar sincronização</button></div>
    </div>
  `;
}

function logHtml(log) {
  const icon = log.type === "shop" ? "□" : log.type === "task" ? "✓" : "!";
  return `
    <div class="list-item">
      <span class="nav-icon">${icon}</span>
      <div>
        <div class="item-name">${escapeHtml(log.text)}</div>
        <div class="item-meta">${formatDate(log.createdAt)}</div>
      </div>
    </div>
  `;
}

function optionHtml(value, selected = "") {
  return `<option ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`;
}

function empty(title, text = "", icon = "✨") {
  return `<div class="empty"><span>${icon}</span><b>${escapeHtml(title)}</b>${text ? `<small>${escapeHtml(text)}</small>` : ""}</div>`;
}

function render() {
  renderDashboard();
  renderShopping();
  renderTasks();
  renderNotifications();
  renderSettings();
}

function handleClick(event) {
  const goButton = event.target.closest("[data-go]");
  if (goButton) {
    goTo(goButton.dataset.go);
    return;
  }

  const navButton = event.target.closest("[data-tab]");
  if (navButton) {
    goTo(navButton.dataset.tab);
    return;
  }

  const categoryButton = event.target.closest("[data-filter-category]");
  if (categoryButton) {
    setItemFilter(categoryButton.dataset.filterCategory);
    return;
  }

  const reminderButton = event.target.closest("[data-reminder]");
  if (reminderButton) {
    const input = $("#taskReminder");
    if (input) input.value = reminderQuickValue(reminderButton.dataset.reminder);
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;

  const { action, id } = actionButton.dataset;
  const actions = {
    "sync": syncNow,
    "quick-add": quickAdd,
    "clear-done": clearDone,
    "export": exportData,
    "enable-notifications": enableNotifications,
    "toggle-local-notifications": toggleLocalNotifications,
    "toggle-supermarket-mode": toggleSupermarketMode,
    "enter-store-mode": enterStoreMode,
    "test-notification": testLocalNotification,
    "copy-token": copyFcmToken,
    "force-update": forceAppUpdate,
    "toggle-dark": toggleDarkMode,
    "clear-local": clearLocalData,
    "toggle-item": () => toggleItem(id),
    "delete-item": () => deleteItem(id),
    "toggle-urgent-item": () => toggleUrgentItem(id),
    "toggle-task": () => toggleTask(id),
    "toggle-urgent-task": () => toggleUrgentTask(id),
    "delete-task": () => deleteTask(id),
    "toggle-notification-pref": () => toggleNotificationPref(actionButton.dataset.pref)
  };

  actions[action]?.();
}

function handleChange(event) {
  const setting = event.target.dataset.setting;
  if (setting === "itemFilter") setItemFilter(event.target.value);
  if (setting === "taskFilter") setTaskFilter(event.target.value);
  if (setting === "profileName") setProfileName(event.target.value);
}

let updateReloadStarted = false;

function setupPwaAutoUpdate(registration) {
  if (!("serviceWorker" in navigator) || !registration) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updateReloadStarted) return;
    updateReloadStarted = true;
    showUpdateScreen("Atualização concluída", "A abrir a nova versão da app...");
    setTimeout(() => window.location.reload(), 650);
  });

  const activateWaitingWorker = () => {
    if (registration.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
    }
  };

  registration.addEventListener("updatefound", () => {
    const newWorker = registration.installing;
    if (!newWorker) return;

    newWorker.addEventListener("statechange", () => {
      if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
        showUpdateScreen("Nova versão encontrada", "A instalar a atualização automaticamente...");
        newWorker.postMessage({ type: "SKIP_WAITING" });
      }
    });
  });

  activateWaitingWorker();

  const checkForUpdate = () => registration.update().catch(error => {
    console.warn("Não consegui procurar atualização da PWA.", error);
  });

  window.addEventListener("focus", checkForUpdate);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkForUpdate();
  });
  setInterval(checkForUpdate, 15 * 60 * 1000);
}

async function forceAppUpdate() {
  if (!("serviceWorker" in navigator)) {
    toast("Atualizações automáticas não são suportadas neste navegador.");
    return;
  }

  try {
    const registration = await getServiceWorkerRegistration();
    await registration.update();

    if (registration.waiting) {
      showUpdateScreen("Nova versão encontrada", "A instalar a atualização agora...");
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      return;
    }

    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith("ricardo-carol-pwa-")).map(key => caches.delete(key)));
    }

    showUpdateScreen("A atualizar a app", "A limpar cache antiga e a abrir a versão mais recente...");
    setTimeout(() => window.location.reload(), 650);
  } catch (error) {
    console.warn("Atualização manual falhou.", error);
    toast("Não consegui atualizar agora. Tenta fechar e abrir a app.");
  }
}

function registerServiceWorker() {
  getServiceWorkerRegistration()
    .then(setupPwaAutoUpdate)
    .catch(error => {
      console.warn("Service worker não registado.", error);
    });
}


function lockAppViewport() {
  const root = document.documentElement;
  const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const updateViewport = () => {
    const visualHeight = window.visualViewport?.height || window.innerHeight;
    root.style.setProperty("--app-height", `${Math.round(visualHeight)}px`);
    root.classList.toggle("standalone", isStandaloneApp());
    root.classList.toggle("ios", isiOS);
  };

  updateViewport();
  window.addEventListener("resize", updateViewport);
  window.addEventListener("orientationchange", () => setTimeout(updateViewport, 350));
  window.visualViewport?.addEventListener("resize", updateViewport);

  document.addEventListener("gesturestart", event => event.preventDefault(), { passive: false });
  document.addEventListener("gesturechange", event => event.preventDefault(), { passive: false });
  document.addEventListener("gestureend", event => event.preventDefault(), { passive: false });

  let lastTouchEnd = 0;
  document.addEventListener("touchend", event => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) event.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  let startY = 0;
  document.addEventListener("touchstart", event => {
    startY = event.touches?.[0]?.clientY || 0;
  }, { passive: true });

  document.addEventListener("touchmove", event => {
    const scrollArea = event.target.closest?.(".main");
    if (!scrollArea) {
      event.preventDefault();
      return;
    }

    const currentY = event.touches?.[0]?.clientY || 0;
    const deltaY = currentY - startY;
    const atTop = scrollArea.scrollTop <= 0;
    const atBottom = Math.ceil(scrollArea.scrollTop + scrollArea.clientHeight) >= scrollArea.scrollHeight;

    if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
      event.preventDefault();
    }
  }, { passive: false });
}

window.addEventListener("online", updateConnectionState);
window.addEventListener("offline", updateConnectionState);
window.addEventListener("hashchange", () => goTo(location.hash.replace("#", "") || "dashboard"));
document.addEventListener("click", handleClick);
document.addEventListener("change", handleChange);

renderNavigation();
loadCaches();
render();
goTo(location.hash.replace("#", "") || "dashboard");
updateConnectionState();
lockAppViewport();
registerServiceWorker();
initFirebase();
