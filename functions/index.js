const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

const DEFAULT_PREFS = {
  newShopping: true,
  newTasks: true,
  urgent: true,
  reminders: true,
  done: false
};

function cleanText(value, fallback = "") {
  return String(value || fallback).trim().slice(0, 140);
}

function prefEnabled(data, preferenceKey) {
  if (!preferenceKey) return true;
  const prefs = { ...DEFAULT_PREFS, ...(data.notificationPrefs || {}) };
  return prefs[preferenceKey] !== false;
}

async function sendPush({ roomId, senderUid, senderName, title, body, url, preferenceKey, includeSender = false }) {
  const tokensSnap = await db.collection("casal").doc(roomId).collection("tokens").get();

  const targets = [];
  const tokenDocIds = [];

  tokensSnap.forEach(doc => {
    const data = doc.data() || {};
    const token = data.token;
    if (!token || typeof token !== "string") return;
    if (!prefEnabled(data, preferenceKey)) return;

    const sameUid = senderUid && data.uid === senderUid;
    const samePerson = senderName && data.profileName === senderName;

    if (!includeSender && (sameUid || samePerson)) return;

    targets.push(token);
    tokenDocIds.push(doc.id);
  });

  if (!targets.length) {
    logger.info("Sem tokens de destino para notificar.", { roomId, senderUid, senderName, preferenceKey });
    return;
  }

  const batches = [];
  for (let i = 0; i < targets.length; i += 500) {
    batches.push({
      tokens: targets.slice(i, i + 500),
      ids: tokenDocIds.slice(i, i + 500)
    });
  }

  for (const batch of batches) {
    const response = await messaging.sendEachForMulticast({
      tokens: batch.tokens,
      notification: {
        title,
        body
      },
      data: {
        url,
        roomId,
        senderName: senderName || "",
        preferenceKey: preferenceKey || "",
        createdAt: new Date().toISOString()
      },
      webpush: {
        fcmOptions: {
          link: url
        },
        notification: {
          icon: "/assets/icon-192.png",
          badge: "/assets/icon-192.png",
          requireInteraction: preferenceKey === "urgent" || preferenceKey === "reminders"
        }
      }
    });

    const deletions = [];
    response.responses.forEach((result, index) => {
      if (result.success) return;
      const code = result.error && result.error.code;
      logger.warn("Falha ao enviar push.", { code, tokenDocId: batch.ids[index] });
      if (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token" ||
        code === "messaging/invalid-argument"
      ) {
        deletions.push(
          db.collection("casal").doc(roomId).collection("tokens").doc(batch.ids[index]).delete()
        );
      }
    });

    await Promise.allSettled(deletions);
    logger.info("Push processado.", {
      roomId,
      preferenceKey,
      successCount: response.successCount,
      failureCount: response.failureCount
    });
  }
}

exports.notifyNewShoppingItem = onDocumentCreated(
  {
    document: "casal/{roomId}/compras/{itemId}",
    region: "europe-west1"
  },
  async event => {
    const item = event.data && event.data.data();
    if (!item) return;

    const senderName = cleanText(item.byName, "Alguém");
    const product = cleanText(item.name, "Novo produto");
    const qty = cleanText(item.qty, "1");
    const urgent = item.urgent === true;

    await sendPush({
      roomId: event.params.roomId,
      senderUid: item.by,
      senderName: item.byName,
      preferenceKey: urgent ? "urgent" : "newShopping",
      title: urgent ? "Compra urgente" : "Nova compra adicionada",
      body: `${senderName} adicionou: ${product}${qty ? ` · ${qty}` : ""}`,
      url: "/#compras"
    });
  }
);

exports.notifyNewTask = onDocumentCreated(
  {
    document: "casal/{roomId}/tarefas/{taskId}",
    region: "europe-west1"
  },
  async event => {
    const task = event.data && event.data.data();
    if (!task) return;

    const senderName = cleanText(task.byName, "Alguém");
    const title = cleanText(task.title, "Nova tarefa");
    const priority = cleanText(task.priority, "Normal");
    const urgent = priority === "Alta";

    await sendPush({
      roomId: event.params.roomId,
      senderUid: task.by,
      senderName: task.byName,
      preferenceKey: urgent ? "urgent" : "newTasks",
      title: urgent ? "Tarefa urgente" : "Nova tarefa criada",
      body: `${senderName} criou: ${title}${task.reminderAt ? ` · ⏰ ${cleanText(task.reminderLabel, "com lembrete")}` : ` · ${priority}`}`,
      url: "/#tarefas"
    });
  }
);

exports.notifyShoppingUpdate = onDocumentUpdated(
  {
    document: "casal/{roomId}/compras/{itemId}",
    region: "europe-west1"
  },
  async event => {
    const before = event.data.before.data() || {};
    const after = event.data.after.data() || {};
    const roomId = event.params.roomId;
    const senderName = cleanText(after.updatedByName || after.completedByName || after.byName, "Alguém");
    const product = cleanText(after.name, "Produto");

    if (before.urgent !== true && after.urgent === true) {
      await sendPush({
        roomId,
        senderUid: null,
        senderName: after.updatedByName || after.byName,
        preferenceKey: "urgent",
        title: "Compra marcada como urgente",
        body: `${cleanText(after.updatedByName || after.byName, "Alguém")} marcou urgente: ${product}`,
        url: "/#compras"
      });
      return;
    }

    if (before.status !== "done" && after.status === "done") {
      await sendPush({
        roomId,
        senderUid: null,
        senderName: after.updatedByName || after.completedByName || after.byName,
        preferenceKey: "done",
        title: "Compra concluída",
        body: `${senderName} marcou como comprado: ${product}`,
        url: "/#compras"
      });
    }
  }
);

exports.notifyTaskUpdate = onDocumentUpdated(
  {
    document: "casal/{roomId}/tarefas/{taskId}",
    region: "europe-west1"
  },
  async event => {
    const before = event.data.before.data() || {};
    const after = event.data.after.data() || {};
    const roomId = event.params.roomId;
    const taskTitle = cleanText(after.title, "Tarefa");

    if (before.priority !== "Alta" && after.priority === "Alta") {
      await sendPush({
        roomId,
        senderUid: null,
        senderName: after.updatedByName || after.byName,
        preferenceKey: "urgent",
        title: "Tarefa marcada como urgente",
        body: `${cleanText(after.byName, "Alguém")} marcou urgente: ${taskTitle}`,
        url: "/#tarefas"
      });
      return;
    }

    if (before.status !== "done" && after.status === "done") {
      await sendPush({
        roomId,
        senderUid: null,
        senderName: after.updatedByName || after.completedByName || after.byName,
        preferenceKey: "done",
        title: "Tarefa concluída",
        body: `${cleanText(after.completedByName || after.byName, "Alguém")} concluiu: ${taskTitle}`,
        url: "/#tarefas"
      });
    }
  }
);

exports.sendTaskReminders = onSchedule(
  {
    schedule: "every 5 minutes",
    region: "europe-west1",
    timeZone: "Europe/Lisbon"
  },
  async () => {
    const roomId = "principal";
    const nowIso = new Date().toISOString();
    const snap = await db.collection("casal").doc(roomId).collection("tarefas")
      .where("reminderAt", "<=", nowIso)
      .limit(50)
      .get();

    const updates = [];

    for (const doc of snap.docs) {
      const task = doc.data() || {};
      if (task.status === "done" || task.reminderSent === true || !task.reminderAt) continue;

      await sendPush({
        roomId,
        senderUid: task.by,
        senderName: task.byName,
        preferenceKey: "reminders",
        includeSender: true,
        title: "Lembrete de tarefa",
        body: `${cleanText(task.title, "Tarefa")} · ${cleanText(task.reminderLabel, "agora")}`,
        url: "/#tarefas"
      });

      updates.push(doc.ref.set({
        reminderSent: true,
        reminderSentAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true }));
    }

    await Promise.allSettled(updates);
    logger.info("Lembretes processados.", { count: updates.length });
  }
);
