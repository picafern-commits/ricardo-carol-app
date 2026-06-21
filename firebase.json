const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

function cleanText(value, fallback = "") {
  return String(value || fallback).trim().slice(0, 120);
}

async function sendPushToOtherPerson({ roomId, senderUid, senderName, title, body, url }) {
  const tokensSnap = await db.collection("casal").doc(roomId).collection("tokens").get();

  const targets = [];
  const tokenDocIds = [];

  tokensSnap.forEach(doc => {
    const data = doc.data() || {};
    const token = data.token;
    if (!token || typeof token !== "string") return;

    const sameUid = senderUid && data.uid === senderUid;
    const samePerson = senderName && data.profileName === senderName;

    if (sameUid || samePerson) return;

    targets.push(token);
    tokenDocIds.push(doc.id);
  });

  if (!targets.length) {
    logger.info("Sem tokens de destino para notificar.", { roomId, senderUid, senderName });
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
        createdAt: new Date().toISOString()
      },
      webpush: {
        fcmOptions: {
          link: url
        },
        notification: {
          icon: "/assets/icon-192.png",
          badge: "/assets/icon-192.png",
          requireInteraction: false
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
    logger.info("Push automático processado.", {
      roomId,
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

    await sendPushToOtherPerson({
      roomId: event.params.roomId,
      senderUid: item.by,
      senderName: item.byName,
      title: "Nova compra adicionada",
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

    await sendPushToOtherPerson({
      roomId: event.params.roomId,
      senderUid: task.by,
      senderName: task.byName,
      title: "Nova tarefa criada",
      body: `${senderName} criou: ${title} · ${priority}`,
      url: "/#tarefas"
    });
  }
);
