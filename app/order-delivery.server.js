import db from "./db.server";
import { disconnectShopifyBilling } from "./billing.server";
import { sendOrderToTagioo } from "./tagioo.server";

const POLL_INTERVAL_MS = 5_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;
let workerRunning = false;

function runOrderDeliveryWorker() {
  void flushOrderDeliveries().catch((error) => {
    console.error(`[Tagioo] order delivery worker failed: ${error.message}`);
  });
}

function deliveryId(shop, order) {
  const orderId = String(order.admin_graphql_api_id || order.id || "");
  if (!orderId) throw new Error("Shopify order is missing an ID.");
  return `${shop}:${orderId}`;
}

function retryDelayMs(attempts) {
  return Math.min(MAX_RETRY_DELAY_MS, 5_000 * (2 ** Math.min(attempts, 8)));
}

export async function enqueueOrderDelivery({ shop, order, topic }) {
  await db.orderDelivery.upsert({
    where: { id: deliveryId(shop, order) },
    create: {
      id: deliveryId(shop, order),
      shop,
      topic,
      payload: JSON.stringify(order),
    },
    update: {},
  });
  runOrderDeliveryWorker();
}

export async function enqueueAppUninstall(connection) {
  if (!connection) return;
  const { shop } = connection;
  const payload = JSON.stringify(connection);
  await db.$transaction([
    db.orderDelivery.upsert({
      where: { id: `${shop}:app-uninstalled` },
      create: { id: `${shop}:app-uninstalled`, shop, topic: "APP_UNINSTALLED", payload },
      update: { payload, attempts: 0, nextAttemptAt: new Date(), lastError: null },
    }),
    db.session.deleteMany({ where: { shop } }),
    db.orderDelivery.deleteMany({ where: { shop, topic: { not: "APP_UNINSTALLED" } } }),
    db.storeConnection.deleteMany({ where: { shop } }),
  ]);
}

export async function deleteQueuedOrdersForShop(shop) {
  await db.orderDelivery.deleteMany({ where: { shop, topic: { not: "APP_UNINSTALLED" } } });
}

export async function deleteQueuedOrdersForCustomer(shop, payload) {
  const customerId = String(payload.customer?.id || "");
  const orderIds = new Set((payload.orders_to_redact || []).map(String));
  const deliveries = await db.orderDelivery.findMany({ where: { shop } });
  const ids = deliveries.flatMap((delivery) => {
    try {
      const order = JSON.parse(delivery.payload);
      const queuedCustomerId = String(order.customer?.id || "");
      const queuedOrderId = String(order.id || "");
      return (customerId && queuedCustomerId === customerId) || orderIds.has(queuedOrderId)
        ? [delivery.id]
        : [];
    } catch {
      return [];
    }
  });
  if (ids.length) await db.orderDelivery.deleteMany({ where: { id: { in: ids } } });
}

export async function flushOrderDeliveries() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    const deliveries = await db.orderDelivery.findMany({
      where: { nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    for (const delivery of deliveries) {
      try {
        const payload = JSON.parse(delivery.payload);
        if (delivery.topic === "APP_UNINSTALLED") {
          const reconnected = await db.storeConnection.findUnique({ where: { shop: delivery.shop } });
          const sameConnection = reconnected
            && reconnected.tenantId === payload.tenantId
            && reconnected.integrationToken === payload.integrationToken;
          if (!sameConnection) await disconnectShopifyBilling(payload);
        } else {
          await sendOrderToTagioo({ shop: delivery.shop, order: payload, topic: delivery.topic });
        }
        await db.orderDelivery.delete({ where: { id: delivery.id } });
      } catch (error) {
        const attempts = delivery.attempts + 1;
        const message = error instanceof Error ? error.message : String(error);
        await db.orderDelivery.update({
          where: { id: delivery.id },
          data: {
            attempts,
            lastError: message,
            nextAttemptAt: new Date(Date.now() + retryDelayMs(attempts)),
          },
        });
        await db.storeConnection.updateMany({
          where: { shop: delivery.shop },
          data: { lastError: message },
        });
      }
    }
  } finally {
    workerRunning = false;
  }
}

const poller = setInterval(runOrderDeliveryWorker, POLL_INTERVAL_MS);
poller.unref();
const startup = setTimeout(runOrderDeliveryWorker, 0);
startup.unref();
