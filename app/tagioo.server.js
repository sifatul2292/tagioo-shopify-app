import crypto from "node:crypto";
import db from "./db.server";

const baseUrl = String(process.env.TAGIOO_API_URL || "https://tagioo.com").replace(/\/$/, "");

export async function redeemConnectionCode({ code, shop }) {
  const response = await fetch(`${baseUrl}/api/integrations/shopify/connect`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: String(code || "").trim(), shop }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || result.errors?.[0] || "Tagioo could not connect this store.");
  }
  return result;
}

export async function sendOrderToTagioo({ shop, order, topic }) {
  const connection = await db.storeConnection.findUnique({ where: { shop } });
  if (!connection || connection.status !== "connected") return { skipped: true };

  const payload = JSON.stringify({
    order_id: String(order.admin_graphql_api_id || order.id || ""),
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

  const response = await fetch(
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
  const connection = await db.storeConnection.findUnique({ where: { shop } });
  if (!connection || connection.status !== "connected") return { skipped: true };

  const body = JSON.stringify({ shop, topic, payload });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto
    .createHmac("sha256", connection.integrationToken)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  const response = await fetch(
    `${baseUrl}/api/integrations/shopify/privacy?tenant=${encodeURIComponent(connection.tenantId)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tagioo-timestamp": timestamp,
        "x-tagioo-signature": signature,
      },
      body,
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Tagioo returned HTTP ${response.status}.`);
  return result;
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
    { variables: { id: pixelId } },
  );
  const json = await response.json();
  const result = json.data?.webPixelDelete;
  if (result?.userErrors?.length) throw new Error(result.userErrors.map((error) => error.message).join(" "));
}
