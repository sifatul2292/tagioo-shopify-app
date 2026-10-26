import crypto from "node:crypto";
import db from "./db.server";
import { privacyConnections } from "./privacy-routing.server";
import { shopifyOrderId } from "./shopify-order-id";

const baseUrl = String(process.env.TAGIOO_API_URL || "https://tagioo.com").replace(/\/$/, "");
const requestTimeoutMs = 10_000;
// Shared with the panel (same name there). Signs workspace calls and one-click
// dashboard links; values under 32 characters leave both features off.
const appSecret = String(process.env.TAGIOO_SHOPIFY_APP_SECRET || "");
const appSecretUsable = appSecret.length >= 32;
const dashboardLinkTtlMs = 9 * 60_000;
// Tagioo accepts account links for up to an hour; the page refreshes them
// whenever the merchant comes back to it.
const accountLinkTtlMs = 50 * 60_000;
// Creating a container may launch it right away (Docker, Nginx, SSL).
const containerCreateTimeoutMs = 120_000;

function tagiooFetch(url, options) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(requestTimeoutMs) });
}

function signedAppToken(claims, ttlMs) {
  const payload = Buffer.from(JSON.stringify({
    ...claims,
    nonce: crypto.randomBytes(18).toString("base64url"),
    exp: Date.now() + ttlMs,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", appSecret).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

// Tagioo marks a signup or login reached through these links as Shopify-billed,
// so a merchant from this app is never offered off-platform payment. The link
// is signed, which proves to Tagioo that the merchant came from this store's
// admin; only then can the store connect to that workspace's containers.
export function tagiooAccountLinks(shop) {
  const start = appSecretUsable
    ? `${baseUrl}/shopify/start?token=${signedAppToken({ shop, purpose: "start" }, accountLinkTtlMs)}`
    : `${baseUrl}/shopify/start?shop=${encodeURIComponent(shop)}`;
  return { signupUrl: start, loginUrl: `${start}&account=existing` };
}

async function signedTagiooPost(path, body, timeoutMs = requestTimeoutMs) {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac("sha256", appSecret).update(`${timestamp}.${raw}`).digest("hex");
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "content-type": "application/json",
      "x-tagioo-timestamp": timestamp,
      "x-tagioo-signature": signature,
    },
    body: raw,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || `Tagioo returned HTTP ${response.status}.`);
    error.status = response.status;
    error.code = result.code || "";
    throw error;
  }
  return result;
}

// Which Tagioo workspace this store belongs to, and that workspace's tracking
// containers. `available: false` means the link is not configured or Tagioo
// did not answer; the UI then falls back to the plain account links.
export async function fetchTagiooWorkspace(shop, tenantId = "") {
  if (!appSecretUsable) return { available: false, linked: false };
  try {
    const result = await signedTagiooPost("/api/integrations/shopify/workspace", { shop, tenantId, intent: "status" }, 4_000);
    return {
      available: true,
      linked: Boolean(result.linked),
      tenantId: result.tenantId || "",
      tenantName: result.tenantName || "",
      containers: Array.isArray(result.containers) ? result.containers : [],
      dnsTarget: result.dnsTarget || "",
    };
  } catch (error) {
    console.error(`[Tagioo] workspace lookup failed for ${shop}: ${error.message}`);
    return { available: false, linked: false };
  }
}

export function isNetworkError(error) {
  return /fetch failed|no response available|network|timeout|aborted|ECONNRESET|ETIMEDOUT|socket/i.test(String(error?.message || ""));
}

// Right after install the first Admin API call can lose its connection while
// Shopify issues the app's access token; one retry covers that.
async function loadShopDetails(admin, retryDelayMs = 1_000) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await admin.graphql(`#graphql
        query TagiooWorkspaceShop {
          shop {
            name
            email
            contactEmail
            shopOwnerName
            billingAddress { countryCodeV2 }
            primaryDomain { url }
          }
        }
      `);
      const result = await response.json();
      return result.data?.shop || {};
    } catch (error) {
      if (attempt >= 2 || !isNetworkError(error)) throw error;
      console.error(`[Tagioo] shop details request failed, retrying: ${error.message}`, error.cause || "");
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
}

// Creates a Free, Shopify-billed Tagioo workspace from the store's own details,
// so the merchant never signs up on tagioo.com.
export async function createTagiooWorkspace(admin, shop) {
  if (!appSecretUsable) throw new Error("Tagioo workspace creation is not configured yet. Use Create free Tagioo account instead.");
  const info = await loadShopDetails(admin);
  return signedTagiooPost("/api/integrations/shopify/workspace", {
    shop,
    intent: "create",
    shopName: info.name || "",
    email: info.email || info.contactEmail || "",
    ownerName: info.shopOwnerName || "",
    country: info.billingAddress?.countryCodeV2 || "",
  });
}

// A single-use link that signs the merchant into their Tagioo workspace.
export function tagiooDashboardUrl(shop, tenantId = "") {
  if (!appSecretUsable) return "";
  return `${baseUrl}/shopify/login?token=${signedAppToken({ shop, tenantId }, dashboardLinkTtlMs)}`;
}

function requireAppLink() {
  if (!appSecretUsable) throw new Error("The Tagioo app link is not configured yet. Contact Tagioo support.");
}

// One-click connect: Tagioo checks that this store is linked to the workspace
// and that no other store uses the container, then returns the tracking
// settings for the app pixel. No connection code is involved.
export async function connectTagiooContainer({ shop, tenantId, containerId }) {
  requireAppLink();
  return signedTagiooPost("/api/integrations/shopify/workspace", { shop, intent: "connect", tenantId, containerId: containerId || "" });
}

// Creates a tracking container for this store from inside Shopify admin and
// connects the store to it. The website comes from the store's primary domain.
export async function createTagiooContainer(admin, { shop, tenantId, fields }) {
  requireAppLink();
  const info = await loadShopDetails(admin);
  return signedTagiooPost("/api/integrations/shopify/workspace", {
    shop,
    tenantId,
    intent: "create-container",
    shopName: info.name || "",
    websiteUrl: info.primaryDomain?.url || `https://${shop}`,
    trackingDomain: String(fields.trackingDomain || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase(),
    containerConfig: String(fields.containerConfig || "").trim(),
    ga4MeasurementId: String(fields.ga4MeasurementId || "").trim(),
    metaPixelId: String(fields.metaPixelId || "").trim(),
    metaAccessToken: String(fields.metaAccessToken || "").trim(),
  }, containerCreateTimeoutMs);
}

// Retries launching the store's container once its DNS record is in place.
export async function checkTagiooDns({ shop, tenantId }) {
  requireAppLink();
  return signedTagiooPost("/api/integrations/shopify/workspace", { shop, intent: "check-dns", tenantId }, 90_000);
}

// The server GTM container template for this store's Tagioo container.
export async function fetchServerTemplate({ shop, tenantId }) {
  requireAppLink();
  return signedTagiooPost("/api/integrations/shopify/workspace", { shop, intent: "server-template", tenantId });
}

export async function sendOrderToTagioo({ shop, order, topic }) {
  const connection = await db.storeConnection.findUnique({ where: { shop } });
  if (!connection || connection.status !== "connected") return { skipped: true };

  const payload = JSON.stringify({
    order_id: shopifyOrderId(order),
    display_order_id: String(order.name || order.order_number || order.id || ""),
    total: order.current_total_price || order.total_price,
    currency: order.currency || order.presentment_currency,
    created_at: order.created_at,
    status: topic === "ORDERS_PAID" ? "paid" : String(order.financial_status || ""),
    order_type: "shopify",
    source: "tagioo-shopify-app",
    customer_id: String(order.customer?.admin_graphql_api_id || order.customer?.id || ""),
    email: order.email || order.customer?.email || "",
    phone: order.phone || order.billing_address?.phone || order.customer?.phone || "",
    first_name: order.billing_address?.first_name || order.customer?.first_name || "",
    last_name: order.billing_address?.last_name || order.customer?.last_name || "",
    city: order.billing_address?.city || "",
    state: order.billing_address?.province || "",
    postcode: order.billing_address?.zip || "",
    country: order.billing_address?.country_code || "",
    customer_ip: order.browser_ip || "",
    customer_user_agent: order.client_details?.user_agent || "",
    order_url: order.order_status_url || `https://${shop}`,
    items: (order.line_items || []).map((item) => ({
      item_id: String(item.product_id || item.variant_id || item.sku || ""),
      item_name: item.name || item.title || "",
      price: item.price,
      quantity: item.quantity,
    })),
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac("sha256", connection.integrationToken)
    .update(`${timestamp}.${payload}`)
    .digest("hex");

  const response = await tagiooFetch(
    `${baseUrl}/api/orders/shopify?tenant=${encodeURIComponent(connection.tenantId)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tagioo-timestamp": timestamp,
        "x-tagioo-signature": signature,
      },
      body: payload,
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || result.errors?.[0] || `Tagioo returned HTTP ${response.status}.`);
  await db.storeConnection.update({
    where: { shop },
    data: { lastOrderAt: new Date(), lastError: null },
  });
  return result;
}

export async function sendPrivacyEventToTagioo({ shop, payload, topic }) {
  const connections = await privacyConnections(shop);
  for (const connection of connections) {
    const body = JSON.stringify({ shop, topic, payload });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto
      .createHmac("sha256", connection.integrationToken)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const response = await tagiooFetch(
      `${baseUrl}/api/integrations/shopify/privacy?tenant=${encodeURIComponent(connection.tenantId)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-tagioo-timestamp": timestamp,
          "x-tagioo-signature": signature,
          "x-tagioo-privacy-token": connection.integrationToken,
        },
        body,
      },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Tagioo returned HTTP ${response.status}.`);
  }
  return { accepted: true, connections: connections.length };
}

export async function ensureWebPixel(admin, settings, existingPixelId = null) {
  const input = JSON.stringify({
    trackingDomain: settings.trackingDomain,
    measurementId: settings.measurementId,
  });
  const mutation = existingPixelId
    ? `#graphql
      mutation TagiooWebPixelUpdate($id: ID!, $webPixel: WebPixelInput!) {
        webPixelUpdate(id: $id, webPixel: $webPixel) {
          webPixel { id settings }
          userErrors { field message }
        }
      }`
    : `#graphql
      mutation TagiooWebPixelCreate($webPixel: WebPixelInput!) {
        webPixelCreate(webPixel: $webPixel) {
          webPixel { id settings }
          userErrors { field message }
        }
      }`;
  const response = await admin.graphql(mutation, {
    variables: existingPixelId
      ? { id: existingPixelId, webPixel: { settings: input } }
      : { webPixel: { settings: input } },
  });
  const json = await response.json();
  const result = existingPixelId ? json.data?.webPixelUpdate : json.data?.webPixelCreate;
  if (result?.userErrors?.length) throw new Error(result.userErrors.map((error) => error.message).join(" "));
  if (!result?.webPixel?.id) throw new Error("Shopify did not create the Tagioo app pixel.");
  return result.webPixel;
}

export async function deleteWebPixel(admin, pixelId) {
  if (!pixelId) return;
  const response = await admin.graphql(
    `#graphql
      mutation TagiooWebPixelDelete($id: ID!) {
        webPixelDelete(id: $id) {
          deletedWebPixelId
          userErrors { field message }
        }
      }`,
    { variables: { id: pixelId }, tries: 2, signal: AbortSignal.timeout(8_000) },
  );
  const json = await response.json();
  const result = json.data?.webPixelDelete;
  if (json.errors?.length) throw new Error(json.errors.map((error) => error.message).join(" "));
  if (result?.userErrors?.length) throw new Error(result.userErrors.map((error) => error.message).join(" "));
  if (!result?.deletedWebPixelId) throw new Error("Shopify did not confirm pixel removal. Retry Disconnect before enabling a manual pixel.");
}
