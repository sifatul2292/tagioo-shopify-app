import { useEffect } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { retainPrivacyRoute } from "../privacy-routing.server";
import { billingView, disconnectShopifyBilling, syncShopifyBilling } from "../billing.server";
import { deleteQueuedOrdersForShop } from "../order-delivery.server";
import {
  createTagiooWorkspace,
  deleteWebPixel,
  ensureWebPixel,
  fetchTagiooWorkspace,
  redeemConnectionCode,
  tagiooAccountLinks,
  tagiooDashboardUrl,
} from "../tagioo.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  let connection = await db.storeConnection.findUnique({ where: { shop: session.shop } });
  if (connection) {
    const force = new URL(request.url).searchParams.has("plan_handle");
    const refresh = (async () => {
      if (!connection.shopId) {
        const response = await admin.graphql(`#graphql
          query LoadShopId {
            shop { id }
          }
        `, { signal: AbortSignal.timeout(8_000) });
        const result = await response.json();
        const shopId = result.data?.shop?.id || "";
        if (shopId) connection = await db.storeConnection.update({ where: { shop: session.shop }, data: { shopId } });
      }
      await syncShopifyBilling(connection, { force });
    })().catch((error) => console.error(`[Tagioo] background billing refresh failed: ${error.message}`));
    if (force) {
      // Shopify's approval return must display the newly confirmed entitlement.
      await refresh;
      connection = await db.storeConnection.findUnique({ where: { shop: session.shop } });
    }
  }
  const workspace = connection
    ? { available: true, linked: true, tenantId: connection.tenantId, tenantName: connection.tenantName || connection.tenantId }
    : await fetchTagiooWorkspace(session.shop);
  return {
    shop: session.shop,
    connection,
    billing: billingView(connection, session.shop),
    tagioo: {
      ...tagiooAccountLinks(session.shop),
      workspace,
      dashboardUrl: workspace.linked ? tagiooDashboardUrl(session.shop, workspace.tenantId) : "",
    },
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "connect");

  if (intent === "create-workspace") {
    try {
      const workspace = await createTagiooWorkspace(admin, session.shop);
      return { ok: true, message: workspace.created ? "Your Tagioo workspace is ready." : "This store already has a Tagioo workspace." };
    } catch (error) {
      return { ok: false, error: error.message, accountExists: error.code === "account_exists" };
    }
  }

  if (intent === "disconnect") {
    const existing = await db.storeConnection.findUnique({ where: { shop: session.shop } });
    try {
      await retainPrivacyRoute(existing);
      await disconnectShopifyBilling(existing);
      await deleteWebPixel(admin, existing?.pixelId || null);
      await deleteQueuedOrdersForShop(session.shop);
      await db.storeConnection.deleteMany({ where: { shop: session.shop } });
      return { ok: true, message: "Store disconnected from Tagioo.", connection: null, billing: billingView(null, session.shop) };
    } catch (error) {
      const message = /fetch failed|no response|abort|timeout/i.test(error.message)
        ? "Could not reach Shopify to finish disconnecting. Retry Disconnect; keep the manual pixel disabled until removal succeeds."
        : error.message;
      return { ok: false, error: message, connection: existing, billing: billingView(existing, session.shop) };
    }
  }

  const code = String(form.get("connectionCode") || "").trim();
  if (!code) return { ok: false, error: "Enter the connection code from Tagioo." };

  try {
    const linked = await redeemConnectionCode({ code, shop: session.shop });
    const shopResponse = await admin.graphql(`#graphql
      query ConnectShopId {
        shop {
          id
        }
      }
    `);
    const shopResult = await shopResponse.json();
    const shopId = shopResult.data?.shop?.id || null;
    const existing = await db.storeConnection.findUnique({ where: { shop: session.shop } });
    await retainPrivacyRoute(existing);
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
    return { ok: true, message: "Tagioo tracking is connected.", connection, billing: billingView(connection, session.shop) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

export default function Index() {
  const initial = useLoaderData();
  const fetcher = useFetcher();
  const workspaceFetcher = useFetcher();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const { workspace, dashboardUrl, signupUrl, loginUrl } = initial.tagioo;
  const connection = fetcher.data && Object.prototype.hasOwnProperty.call(fetcher.data, "connection")
    ? fetcher.data.connection
    : initial.connection;
  const billing = fetcher.data?.billing || initial.billing;
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message);
    if (fetcher.data?.error) shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (workspaceFetcher.data?.message) shopify.toast.show(workspaceFetcher.data.message);
  }, [workspaceFetcher.data, shopify]);

  // Each dashboard link works once; fetch a fresh one after it is opened.
  const refreshDashboardLink = () => setTimeout(() => revalidator.revalidate(), 1500);
  const dashboardButton = dashboardUrl ? (
    <s-button href={dashboardUrl} target="_blank" variant="primary" onClick={refreshDashboardLink}>Open Tagioo dashboard</s-button>
  ) : null;

  return (
    <s-page heading="Tagioo Tracking">
      <s-section heading={connection ? "Tracking is connected" : workspace.linked ? "Connect this Shopify store" : "Set up Tagioo for this store"}>
        {connection ? (
          <s-stack direction="block" gap="base">
            <s-banner tone="success" heading="Browser and backend Purchase tracking are active">
              Shopify customer events are sent through your Tagioo server container. Paid orders are also sent from Shopify&apos;s backend for reliable conversion recovery.
            </s-banner>
            {dashboardButton}
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
          <s-stack direction="block" gap="base">
            {workspace.linked ? (
              <>
                <s-banner tone="success" heading={`Tagioo workspace: ${workspace.tenantName}`}>
                  Next, add a tracking container in Tagioo and connect it to this store.
                </s-banner>
                <s-ordered-list>
                  <s-list-item>Open your Tagioo dashboard and add a tracking container.</s-list-item>
                  <s-list-item>In Setup Assistant, choose Shopify and click <s-text>Generate connection code</s-text>.</s-list-item>
                  <s-list-item>Paste that one-time code below.</s-list-item>
                </s-ordered-list>
                {dashboardButton}
              </>
            ) : workspace.available ? (
              <>
                <s-paragraph>Tagioo hosts the server-side tracking container for this store. Create a free workspace for it here; there is no separate sign-up and no card.</s-paragraph>
                <workspaceFetcher.Form method="post">
                  <input type="hidden" name="intent" value="create-workspace" />
                  <s-button type="submit" variant="primary" {...(workspaceFetcher.state !== "idle" ? { loading: true } : {})}>Create my free Tagioo workspace</s-button>
                </workspaceFetcher.Form>
                {workspaceFetcher.data?.error ? (
                  <s-banner tone={workspaceFetcher.data.accountExists ? "warning" : "critical"} heading="Could not create the workspace">
                    {workspaceFetcher.data.error}
                  </s-banner>
                ) : null}
                <s-paragraph>
                  Already use Tagioo for other websites? <s-link href={loginUrl} target="_blank">Sign in to link that account</s-link>. Its plan then moves to Shopify billing for all its sites.
                </s-paragraph>
              </>
            ) : (
              <>
                <s-paragraph>Tagioo hosts the server-side tracking container for this store. Create a free Tagioo account, or sign in, then add a tracking container.</s-paragraph>
                <s-stack direction="inline" gap="base">
                  <s-button href={signupUrl} target="_blank" variant="primary">Create free Tagioo account</s-button>
                  <s-button href={loginUrl} target="_blank">Sign in to Tagioo</s-button>
                </s-stack>
              </>
            )}
            <s-banner tone="info" heading="Billed through Shopify">
              Tagioo starts on the Free plan. Paid plans are chosen and billed only in Shopify; Tagioo never asks for a card.
            </s-banner>
            {billing.enabled ? <s-link href={billing.planSelectionUrl} target="_top">View or change Shopify plan</s-link> : null}
            <fetcher.Form method="post">
              <s-stack direction="block" gap="base">
                <s-text-field label="Tagioo connection code" name="connectionCode" autocomplete="off" required />
                <s-button type="submit" variant={workspace.linked ? "primary" : "secondary"} {...(busy ? { loading: true } : {})}>Connect Tagioo</s-button>
                {fetcher.data?.error ? <s-banner tone="critical" heading="Could not connect">{fetcher.data.error}</s-banner> : null}
              </s-stack>
            </fetcher.Form>
          </s-stack>
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
