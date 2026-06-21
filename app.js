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

const VAPID_KEY = ""; // Cola aqui a Web Push certificate key pair / VAPID_KEY do Firebase Messaging
const ROOM_ID = "principal";
const STORE = {
  settings: "rc_settings",
  items: "rc_items_cache",
  tasks: "rc_tasks_cache",
  logs: "rc_logs_cache"
};

const tabs = [
  { id: "dashboard", icon: "⌂", label: "Dashboard", sub: "Resumo das compras, tarefas e atividade." },
  { id: "compras", icon: "□", label: "Compras", sub: "Lista partilhada em tempo real." },
  { id: "tarefas", icon: "✓", label: "Tarefas", sub: "Tarefas abertas, prioridades e concluídas." },
  { id: "notificacoes", icon: "!", label: "Notificações", sub: "Alertas locais e base para push." },
  { id: "configuracoes", icon: "⚙", label: "Configurações", sub: "Tema, dados locais e sincronização." }
];

const defaultSettings = {
  darkMode: false,
  localNotifications: true,
  itemFilter: "Todas",
  taskFilter: "Todas"
};

function hasValidVapidKey() {
  return VAPID_KEY && VAPID_KEY.length > 40 && !VAPID_KEY.includes("COLOCA_AQUI");
}


let db = null;
let auth = null;
let messaging = null;
let uid = null;
let remoteReady = false;
let items = [];
let tasks = [];
let logs = [];
let unsubscribe = [];
let settings = { ...defaultSettings, ...readJson(STORE.settings, {}) };

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
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    await enableIndexedDbPersistence(db).catch(error => {
      console.info("Persistência local do Firestore não ativada:", error?.code || error);
    });

    auth = getAuth(app);
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

  const item = {
    name,
    qty: $("#itemQty").value.trim() || "1",
    category: $("#itemCategory").value,
    status: "pending",
    by: uid || "local"
  };

  $("#itemName").value = "";
  $("#itemQty").value = "";
  await writeEntry("compras", item, items);
  await addLog(`Produto adicionado: ${name}`, "shop");
  showLocalNotification("Novo produto", name);
}

async function toggleItem(id) {
  const item = items.find(entry => entry.id === id);
  if (!item) return;
  const done = item.status !== "done";
  await patchEntry("compras", id, {
    status: done ? "done" : "pending",
    doneAt: done ? new Date().toISOString() : null
  }, items);
  await addLog(`${done ? "Comprado" : "Reaberto"}: ${item.name}`, "shop");
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

  const task = {
    title,
    due: $("#taskDue").value,
    priority: $("#taskPriority").value,
    status: "pending",
    by: uid || "local"
  };

  $("#taskTitle").value = "";
  await writeEntry("tarefas", task, tasks);
  await addLog(`Tarefa criada: ${title}`, "task");
  showLocalNotification("Nova tarefa", title);
}

async function toggleTask(id) {
  const task = tasks.find(entry => entry.id === id);
  if (!task) return;
  const done = task.status !== "done";
  await patchEntry("tarefas", id, {
    status: done ? "done" : "pending",
    doneAt: done ? new Date().toISOString() : null
  }, tasks);
  await addLog(`${done ? "Tarefa concluída" : "Tarefa reaberta"}: ${task.title}`, "task");
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
    if (!hasValidVapidKey() || !db || !(await isSupported())) return;
    messaging = getMessaging();
    const registration = await navigator.serviceWorker.ready;
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration
    });
    await setDoc(documentPath("tokens", token), {
      token,
      uid,
      userAgent: navigator.userAgent,
      createdAt: serverTimestamp()
    });
    onMessage(messaging, payload => {
      showLocalNotification(
        payload.notification?.title || "Ricardo & Carol",
        payload.notification?.body || "Nova atualização"
      );
    });
  } catch (error) {
    console.warn("Firebase Messaging ainda não está totalmente configurado.", error);
  }

  render();
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

function visibleItems() {
  const pending = items.filter(item => item.status !== "done");
  if (settings.itemFilter === "Todas") return pending;
  return pending.filter(item => (item.category || "Outros") === settings.itemFilter);
}

function visibleTasks() {
  const pending = tasks.filter(task => task.status !== "done");
  if (settings.taskFilter === "Todas") return pending;
  return pending.filter(task => task.priority === settings.taskFilter || task.due === settings.taskFilter);
}

function itemHtml(item) {
  return `
    <div class="list-item ${item.status === "done" ? "done" : ""}">
      <button class="check-button" type="button" data-action="toggle-item" data-id="${item.id}" aria-label="Alternar produto">✓</button>
      <div>
        <div class="item-name">${escapeHtml(item.name)}</div>
        <div class="item-meta">${escapeHtml(item.qty || "1")} · ${escapeHtml(item.category || "Geral")}</div>
      </div>
      <button class="icon-button" type="button" data-action="delete-item" data-id="${item.id}" aria-label="Apagar produto">×</button>
    </div>
  `;
}

function taskHtml(task) {
  const priority = task.priority || "Normal";
  const extra = priority === "Alta" ? " · prioridade alta" : "";
  return `
    <div class="list-item ${task.status === "done" ? "done" : ""}">
      <button class="check-button" type="button" data-action="toggle-task" data-id="${task.id}" aria-label="Alternar tarefa">✓</button>
      <div>
        <div class="item-name">${escapeHtml(task.title)}</div>
        <div class="item-meta">${escapeHtml(task.due || "Hoje")} · ${escapeHtml(priority)}${extra}</div>
      </div>
      <button class="icon-button" type="button" data-action="delete-task" data-id="${task.id}" aria-label="Apagar tarefa">×</button>
    </div>
  `;
}

function renderDashboard() {
  const pendingItems = items.filter(item => item.status !== "done");
  const pendingTasks = tasks.filter(task => task.status !== "done");
  const urgentTasks = pendingTasks.filter(task => task.priority === "Alta").length;

  $("#dashboard").innerHTML = `
    <div class="grid">
      <div class="panel span-4 kpi"><div><b>${pendingItems.length}</b><span>Compras pendentes</span></div><span class="pill">Lista</span></div>
      <div class="panel span-4 kpi"><div><b>${pendingTasks.length}</b><span>Tarefas abertas</span></div><span class="pill accent">${urgentTasks} altas</span></div>
      <div class="panel span-4 kpi"><div><b>${logs.length}</b><span>Atividades</span></div><span class="pill">${navigator.onLine ? "Online" : "Offline"}</span></div>
      <div class="panel span-6">
        <div class="section-title"><h2>Próximas compras</h2><button class="button secondary" type="button" data-go="compras">Abrir</button></div>
        <div class="list">${pendingItems.slice(0, 5).map(itemHtml).join("") || empty("Sem compras pendentes.")}</div>
      </div>
      <div class="panel span-6">
        <div class="section-title"><h2>Próximas tarefas</h2><button class="button secondary" type="button" data-go="tarefas">Abrir</button></div>
        <div class="list">${pendingTasks.slice(0, 5).map(taskHtml).join("") || empty("Sem tarefas pendentes.")}</div>
      </div>
    </div>
  `;
}

function renderShopping() {
  const pending = items.filter(item => item.status !== "done");
  const done = items.filter(item => item.status === "done");
  const categories = ["Todas", "Supermercado", "Casa", "Farmácia", "Animais", "Outros"];

  $("#compras").innerHTML = `
    <div class="panel">
      <div class="section-title"><h2>Adicionar produto</h2><span class="pill">${pending.length} por comprar</span></div>
      <form class="form" id="itemForm">
        <input class="input" id="itemName" placeholder="Produto" autocomplete="off">
        <input class="input" id="itemQty" placeholder="Qtd" autocomplete="off">
        <select id="itemCategory">${categories.slice(1).map(optionHtml).join("")}</select>
        <button class="button primary" type="submit">Adicionar</button>
      </form>
      <div class="toolbar">
        <select data-setting="itemFilter" aria-label="Filtrar compras">${categories.map(value => optionHtml(value, settings.itemFilter)).join("")}</select>
        <button class="button secondary" type="button" data-action="clear-done">Limpar concluídos</button>
        <button class="button secondary" type="button" data-action="export">Exportar</button>
      </div>
      <div class="list">${visibleItems().map(itemHtml).join("") || empty("A lista está limpa.")}</div>
    </div>
    <div class="panel">
      <div class="section-title"><h2>Comprados</h2><span class="pill">${done.length}</span></div>
      <div class="list">${done.map(itemHtml).join("") || empty("Ainda não há comprados.")}</div>
    </div>
  `;

  $("#itemForm").addEventListener("submit", addItem);
}

function renderTasks() {
  const pending = tasks.filter(task => task.status !== "done");
  const done = tasks.filter(task => task.status === "done");
  const filters = ["Todas", "Alta", "Normal", "Baixa", "Hoje", "Amanhã", "Esta semana", "Sem data"];

  $("#tarefas").innerHTML = `
    <div class="panel">
      <div class="section-title"><h2>Adicionar tarefa</h2><span class="pill">${pending.length} abertas</span></div>
      <form class="form tasks" id="taskForm">
        <input class="input" id="taskTitle" placeholder="Tarefa" autocomplete="off">
        <select id="taskDue">${["Hoje", "Amanhã", "Esta semana", "Sem data"].map(optionHtml).join("")}</select>
        <select id="taskPriority">${["Normal", "Alta", "Baixa"].map(optionHtml).join("")}</select>
        <button class="button primary" type="submit">Adicionar</button>
      </form>
      <div class="toolbar">
        <select data-setting="taskFilter" aria-label="Filtrar tarefas">${filters.map(value => optionHtml(value, settings.taskFilter)).join("")}</select>
        <button class="button secondary" type="button" data-action="clear-done">Limpar concluídos</button>
        <button class="button secondary" type="button" data-action="export">Exportar</button>
      </div>
      <div class="list">${visibleTasks().map(taskHtml).join("") || empty("Sem tarefas abertas.")}</div>
    </div>
    <div class="panel">
      <div class="section-title"><h2>Concluídas</h2><span class="pill">${done.length}</span></div>
      <div class="list">${done.map(taskHtml).join("") || empty("Ainda não há tarefas concluídas.")}</div>
    </div>
  `;

  $("#taskForm").addEventListener("submit", addTask);
}

function renderNotifications() {
  const permission = "Notification" in window ? Notification.permission : "não suportado";
  const pushReady = hasValidVapidKey();

  $("#notificacoes").innerHTML = `
    <div class="panel">
      <div class="section-title"><h2>Notificações</h2><button class="button primary" type="button" data-action="enable-notifications">Ativar neste dispositivo</button></div>
      <div class="settings-row">
        <div><b>Alertas locais</b><small>Estado atual: ${settings.localNotifications ? "ligados" : "desligados"}. Permissão: ${permission}.</small></div>
        <button class="toggle ${settings.localNotifications ? "on" : ""}" type="button" data-action="toggle-local-notifications" aria-label="Alternar notificações locais"></button>
      </div>
      <div class="settings-row">
        <div><b>Firebase Push</b><small>${pushReady ? "Chave VAPID colocada no código." : "A aguardar VAPID_KEY do Firebase."}</small></div>
        <button class="button secondary" type="button" data-action="test-notification">Testar</button>
      </div>
      <p class="note">Para push real com a app fechada: ativa Anonymous Auth, publica as Firestore Rules, gera a Web Push certificate key pair no Firebase Messaging e cola a chave em <b>VAPID_KEY</b> no app.js.</p>
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
        <div><b>Dark mode</b><small>Estado atual: ${settings.darkMode ? "ativo" : "inativo"}.</small></div>
        <button class="toggle ${settings.darkMode ? "on" : ""}" type="button" data-action="toggle-dark" aria-label="Alternar dark mode"></button>
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

function empty(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
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
    "test-notification": testLocalNotification,
    "toggle-dark": toggleDarkMode,
    "clear-local": clearLocalData,
    "toggle-item": () => toggleItem(id),
    "delete-item": () => deleteItem(id),
    "toggle-task": () => toggleTask(id),
    "delete-task": () => deleteTask(id)
  };

  actions[action]?.();
}

function handleChange(event) {
  const setting = event.target.dataset.setting;
  if (setting === "itemFilter") setItemFilter(event.target.value);
  if (setting === "taskFilter") setTaskFilter(event.target.value);
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("service-worker.js").catch(error => {
    console.warn("Service worker não registado.", error);
  });
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
registerServiceWorker();
initFirebase();
