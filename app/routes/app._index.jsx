import { useEffect } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { billingView, disconnectShopifyBilling, syncShopifyBilling } from "../billing.server";
import { deleteQueuedOrdersForShop } from "../order-delivery.server";
import { deleteWebPixel, ensureWebPixel, redeemConnectionCode } from "../tagioo.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  let connection = await db.storeConnection.findUnique({ where: { shop: session.shop } });
  if (connection && !connection.shopId) {
    const response = await admin.graphql(`#graphql { shop { id } }`);
    const result = await response.json();
    const shopId = result.data?.shop?.id || "";
    if (shopId) connection = await db.storeConnection.update({ where: { shop: session.shop }, data: { shopId } });
  }
  if (connection) {
    const force = new URL(request.url).searchParams.has("plan_handle");
    await syncShopifyBilling(connection, { force }).catch(() => {});
    connection = await db.storeConnection.findUnique({ where: { shop: session.shop } });
  }
  return { shop: session.shop, connection, billing: billingView(connection) };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "connect");

  if (intent === "disconnect") {
    const existing = await db.storeConnection.findUnique({ where: { shop: session.shop } });
    try {
      await disconnectShopifyBilling(existing);
      await deleteWebPixel(admin, existing?.pixelId || null);
      await deleteQueuedOrdersForShop(session.shop);
      await db.storeConnection.deleteMany({ where: { shop: session.shop } });
      return { ok: true, message: "Store disconnected from Tagioo.", connection: null, billing: billingView(null) };
    } catch (error) {
      return { ok: false, error: error.message, connection: existing, billing: billingView(existing) };
    }
  }

  const code = String(form.get("connectionCode") || "").trim();
  if (!code) return { ok: false, error: "Enter the connection code from Tagioo." };

  try {
    const linked = await redeemConnectionCode({ code, shop: session.shop });
    const shopResponse = await admin.graphql(`#graphql { shop { id } }`);
    const shopResult = await shopResponse.json();
    const shopId = shopResult.data?.shop?.id || null;
    const existing = await db.storeConnection.findUnique({ where: { shop: session.shop } });
    const pixel = await ensureWebPixel(admin, linked, existing?.pixelId || null);
    let connection = await db.storeConnection.upsert({
      where: { shop: session.shop },
      create: {
        shop: session.shop,
        shopId,
        tenantId: linked.tenantId,
        tenantName: linked.tenantName || null,
        trackingDomain: linked.trackingDomain,
        measurementId: linked.measurementId,
        integrationToken: linked.integrationToken,
        pixelId: pixel.id,
      },
      update: {
        shopId,
        tenantId: linked.tenantId,
        tenantName: linked.tenantName || null,
        trackingDomain: linked.trackingDomain,
        measurementId: linked.measurementId,
        integrationToken: linked.integrationToken,
        pixelId: pixel.id,
        status: "connected",
        lastError: null,
      },
    });
    await syncShopifyBilling(connection, { force: true }).catch(() => {});
    connection = await db.storeConnection.findUnique({ where: { shop: session.shop } });
    return { ok: true, message: "Tagioo tracking is connected.", connection, billing: billingView(connection) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

export default function Index() {
  const initial = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const connection = fetcher.data && Object.prototype.hasOwnProperty.call(fetcher.data, "connection")
    ? fetcher.data.connection
    : initial.connection;
  const billing = fetcher.data?.billing || initial.billing;
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message);
    if (fetcher.data?.error) shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="Tagioo Tracking">
      <s-section heading={connection ? "Tracking is connected" : "Connect this Shopify store"}>
        {connection ? (
          <s-stack direction="block" gap="base">
            <s-banner tone="success" heading="Browser and backend Purchase tracking are active">
              Shopify customer events are sent through your Tagioo server container. Paid orders are also sent from Shopify&apos;s backend for reliable conversion recovery.
            </s-banner>
            <s-paragraph><s-text>Store: </s-text>{initial.shop}</s-paragraph>
            <s-paragraph><s-text>Tagioo workspace: </s-text>{connection.tenantName || connection.tenantId}</s-paragraph>
            <s-paragraph><s-text>Tracking domain: </s-text>{connection.trackingDomain}</s-paragraph>
            <s-paragraph><s-text>Measurement ID: </s-text>{connection.measurementId}</s-paragraph>
            <s-paragraph><s-text>Last backend order: </s-text>{connection.lastOrderAt ? new Date(connection.lastOrderAt).toLocaleString() : "Waiting for the first paid order"}</s-paragraph>
            <s-banner tone={billing.plan === "Free" ? "info" : "success"} heading={`Tagioo ${billing.plan} plan`}>
              {billing.plan === "Free"
                ? "Your first 15,000 events in each 30-day cycle are free. Tracking pauses at the limit until the cycle resets or you approve a paid plan."
                : `Shopify billing is active${billing.cycleEnd ? ` through ${new Date(billing.cycleEnd).toLocaleDateString()}` : ""}.`}
            </s-banner>
            {billing.lastError ? <s-banner tone="critical" heading="Billing status could not be refreshed">Try again shortly or contact Tagioo support before changing plans.</s-banner> : null}
            {billing.enabled ? <s-link href={billing.planSelectionUrl} target="_top">View or change Shopify plan</s-link> : null}
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="disconnect" />
              <s-button type="submit" tone="critical" variant="secondary" {...(busy ? { loading: true } : {})}>Disconnect</s-button>
            </fetcher.Form>
          </s-stack>
        ) : (
          <fetcher.Form method="post">
            <s-stack direction="block" gap="base">
              <s-paragraph>In Tagioo, open Setup Assistant, choose Shopify, and click <s-text>Generate connection code</s-text>. Paste that one-time code below.</s-paragraph>
              <s-text-field label="Tagioo connection code" name="connectionCode" autocomplete="off" required />
              <s-button type="submit" variant="primary" {...(busy ? { loading: true } : {})}>Connect Tagioo</s-button>
              {fetcher.data?.error ? <s-banner tone="critical" heading="Could not connect">{fetcher.data.error}</s-banner> : null}
            </s-stack>
          </fetcher.Form>
        )}
      </s-section>

      <s-section slot="aside" heading="What Tagioo installs">
        <s-unordered-list>
          <s-list-item>A Shopify app pixel for page, product, cart and checkout events</s-list-item>
          <s-list-item>A signed paid-order webhook for reliable Purchase tracking</s-list-item>
          <s-list-item>Matching event IDs so browser and server Purchase deduplicate</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
