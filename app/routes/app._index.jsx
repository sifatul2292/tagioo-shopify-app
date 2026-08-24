import { useEffect } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteWebPixel, ensureWebPixel, redeemConnectionCode } from "../tagioo.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const connection = await db.storeConnection.findUnique({ where: { shop: session.shop } });
  return { shop: session.shop, connection };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "connect");

  if (intent === "disconnect") {
    const existing = await db.storeConnection.findUnique({ where: { shop: session.shop } });
    await deleteWebPixel(admin, existing?.pixelId || null);
    await db.storeConnection.deleteMany({ where: { shop: session.shop } });
    return { ok: true, message: "Store disconnected from Tagioo.", connection: null };
  }

  const code = String(form.get("connectionCode") || "").trim();
  if (!code) return { ok: false, error: "Enter the connection code from Tagioo." };

  try {
    const linked = await redeemConnectionCode({ code, shop: session.shop });
    const existing = await db.storeConnection.findUnique({ where: { shop: session.shop } });
    const pixel = await ensureWebPixel(admin, linked, existing?.pixelId || null);
    const connection = await db.storeConnection.upsert({
      where: { shop: session.shop },
      create: {
        shop: session.shop,
        tenantId: linked.tenantId,
        tenantName: linked.tenantName || null,
        trackingDomain: linked.trackingDomain,
        measurementId: linked.measurementId,
        integrationToken: linked.integrationToken,
        pixelId: pixel.id,
      },
      update: {
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
    return { ok: true, message: "Tagioo tracking is connected.", connection };
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
