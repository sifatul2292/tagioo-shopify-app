import crypto from "node:crypto";
import db from "./db.server";
import {
  fetchActiveSubscription,
  planNameForSubscription,
  shopifyBillingEnabled,
  shopifyPlanSelectionUrl,
} from "./partner-api.server";

const baseUrl = String(process.env.TAGIOO_API_URL || "https://tagioo.com").replace(/\/$/, "");
const CACHE_MS = 5 * 60_000;
const MISSING_GRACE_MS = 24 * 60 * 60_000;
const RECONCILE_MS = 6 * 60 * 60_000;
let reconciliationRunning = false;

function subscriptionAmount(subscription) {
  const price = (subscription?.items || []).find((item) => item.price?.__typename === "FlatRatePrice")?.price;
  return { amount: Number(price?.amount || 0), currency: price?.currency || "USD" };
}

async function sendBillingStateToTagioo(connection, state) {
  const body = JSON.stringify({ shop: connection.shop, ...state });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac("sha256", connection.integrationToken)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const response = await fetch(
    `${baseUrl}/api/integrations/shopify/subscription?tenant=${encodeURIComponent(connection.tenantId)}`,
    {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "content-type": "application/json",
        "x-tagioo-timestamp": timestamp,
        "x-tagioo-signature": signature,
      },
      body,
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || result.errors?.[0] || `Tagioo returned HTTP ${response.status}.`);
}

export async function disconnectShopifyBilling(connection) {
  if (!connection || !shopifyBillingEnabled()) return { skipped: true };
  await sendBillingStateToTagioo(connection, {
    plan: "Free",
    status: "disconnected",
    billingPeriod: "",
    cycleStart: "",
    cycleEnd: "",
    cancelAtEndOfCycle: false,
    amount: 0,
    currency: "USD",
  });
  return { disconnected: true };
}

export async function syncShopifyBilling(connection, { force = false } = {}) {
  if (!connection || !connection.shopId || !shopifyBillingEnabled()) {
    return { configured: false, plan: connection?.billingPlan || "Free" };
  }
  const lastSync = connection.billingSyncedAt ? new Date(connection.billingSyncedAt).getTime() : 0;
  if (!force && Date.now() - lastSync < CACHE_MS) {
    return { configured: true, plan: connection.billingPlan, cached: true };
  }

  try {
    const { configured, subscription } = await fetchActiveSubscription(connection.shopId);
    if (!configured) return { configured: false, plan: connection.billingPlan || "Free" };
    const now = new Date();
    const plan = planNameForSubscription(subscription);
    if (!plan) throw new Error("The active Shopify pricing item is not mapped to a Tagioo plan.");

    if (!subscription && connection.billingPlan !== "Free") {
      const missingSince = connection.billingMissingSince || now;
      const graceExpired = now.getTime() - new Date(missingSince).getTime() >= MISSING_GRACE_MS;
      await db.storeConnection.update({
        where: { shop: connection.shop },
        data: {
          billingStatus: graceExpired ? "free" : "grace",
          billingMissingSince: missingSince,
          billingSyncedAt: now,
          billingLastError: null,
        },
      });
      if (!graceExpired) return { configured: true, plan: connection.billingPlan, grace: true };
    }

    const cycle = subscription?.currentBillingCycle || {};
    const price = subscriptionAmount(subscription);
    const state = {
      plan,
      status: plan === "Free" ? "free" : "active",
      billingPeriod: subscription?.billingPeriod || "",
      cycleStart: cycle.startTime || "",
      cycleEnd: cycle.endTime || subscription?.trialEndsAt || "",
      cancelAtEndOfCycle: Boolean(subscription?.cancelAtEndOfCycle),
      amount: price.amount,
      currency: price.currency,
    };
    await sendBillingStateToTagioo(connection, state);
    await db.storeConnection.update({
      where: { shop: connection.shop },
      data: {
        billingPlan: plan,
        billingStatus: state.status,
        billingCycleEnd: state.cycleEnd ? new Date(state.cycleEnd) : null,
        billingCancelAtEnd: state.cancelAtEndOfCycle,
        billingMissingSince: null,
        billingSyncedAt: now,
        billingLastError: null,
      },
    });
    return { configured: true, ...state };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.storeConnection.updateMany({
      where: { shop: connection.shop },
      data: { billingLastError: message },
    });
    throw error;
  }
}

export function billingView(connection) {
  return {
    enabled: shopifyBillingEnabled(),
    plan: connection?.billingPlan || "Free",
    status: connection?.billingStatus || "free",
    cycleEnd: connection?.billingCycleEnd || null,
    cancelAtEnd: Boolean(connection?.billingCancelAtEnd),
    lastError: connection?.billingLastError || "",
    planSelectionUrl: shopifyPlanSelectionUrl(connection?.shop || ""),
  };
}

async function reconcileBilling() {
  if (reconciliationRunning || !shopifyBillingEnabled()) return;
  reconciliationRunning = true;
  try {
    const connections = await db.storeConnection.findMany({ where: { status: "connected", shopId: { not: null } } });
    for (const connection of connections) {
      await syncShopifyBilling(connection, { force: true }).catch((error) => {
        console.error(`[Tagioo] billing sync failed for ${connection.shop}: ${error.message}`);
      });
    }
  } finally {
    reconciliationRunning = false;
  }
}

const reconciliationTimer = setInterval(() => {
  void reconcileBilling().catch((error) => console.error(`[Tagioo] billing reconciliation failed: ${error.message}`));
}, RECONCILE_MS);
reconciliationTimer.unref();
const initialReconciliationTimer = setTimeout(() => {
  void reconcileBilling().catch((error) => console.error(`[Tagioo] initial billing reconciliation failed: ${error.message}`));
}, 5_000);
initialReconciliationTimer.unref();
