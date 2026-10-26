import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { retainPrivacyRoute } from "../privacy-routing.server";
import { billingView, disconnectShopifyBilling, syncShopifyBilling } from "../billing.server";
import { deleteQueuedOrdersForShop } from "../order-delivery.server";
import {
  checkTagiooDns,
  connectTagiooContainer,
  createTagiooContainer,
  createTagiooWorkspace,
  deleteWebPixel,
  ensureWebPixel,
  fetchServerTemplate,
  fetchTagiooWorkspace,
  isNetworkError,
  tagiooAccountLinks,
  tagiooDashboardUrl,
  unlinkTagiooWorkspace,
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
      console.error(`[Tagioo] workspace creation failed for ${session.shop}: ${error.message}`, error.cause || "");
      const message = isNetworkError(error)
        ? "Tagioo could not reach Shopify just now. Please try again in a moment."
        : error.message;
      return { ok: false, error: message, accountExists: error.code === "account_exists" };
    }
  }

  if (intent === "disconnect") {
    const existing = await db.storeConnection.findUnique({ where: { shop: session.shop } });
    let service = "Tagioo";
    try {
      await retainPrivacyRoute(existing);
      await disconnectShopifyBilling(existing);
      service = "Shopify";
      await deleteWebPixel(admin, existing?.pixelId || null);
      await deleteQueuedOrdersForShop(session.shop);
      await db.storeConnection.deleteMany({ where: { shop: session.shop } });
      return { ok: true, message: "Store disconnected from Tagioo.", connection: null, billing: billingView(null, session.shop) };
    } catch (error) {
      console.error(`[Tagioo] disconnect failed at ${service} for ${session.shop}: ${error.message}`, error.cause || "");
      const message = /fetch failed|no response|abort|timeout|network/i.test(error.message)
        ? `${service} did not answer in time, so the store is still connected. Click Disconnect again.`
        : error.message;
      return { ok: false, error: message, connection: existing, billing: billingView(existing, session.shop) };
    }
  }

  if (intent === "unlink") {
    try {
      await unlinkTagiooWorkspace({ shop: session.shop, tenantId: String(form.get("tenantId") || "") });
      return { unlinked: true, message: "This store no longer uses that Tagioo workspace." };
    } catch (error) {
      return { unlinked: false, error: isNetworkError(error) ? "Tagioo could not be reached just now. Please try again in a moment." : error.message };
    }
  }

  if (intent === "container-status") {
    const existing = await db.storeConnection.findUnique({ where: { shop: session.shop } });
    const workspace = await fetchTagiooWorkspace(session.shop, existing?.tenantId || "");
    const container = (workspace.containers || []).find((item) => item.connectedShop === session.shop) || null;
    return { containerStatus: { available: workspace.available, container, dnsTarget: workspace.dnsTarget || "" } };
  }

  if (intent === "check-dns") {
    const existing = await db.storeConnection.findUnique({ where: { shop: session.shop } });
    try {
      const result = await checkTagiooDns({ shop: session.shop, tenantId: existing?.tenantId || "" });
      const message = result.status === "live" || result.status === "http_live"
        ? "Your tracking domain is live."
        : result.retryAfterSeconds
          ? `Checked a moment ago. Try again in ${result.retryAfterSeconds} seconds.`
          : "The DNS record is not visible yet. DNS changes can take up to an hour.";
      return { dnsCheck: { status: result.status, message } };
    } catch (error) {
      return { dnsCheck: { error: error.message } };
    }
  }

  if (intent === "server-template") {
    const existing = await db.storeConnection.findUnique({ where: { shop: session.shop } });
    try {
      return { serverTemplate: await fetchServerTemplate({ shop: session.shop, tenantId: existing?.tenantId || "" }) };
    } catch (error) {
      return { serverTemplate: { error: error.message } };
    }
  }

  const tenantId = String(form.get("tenantId") || "");
  try {
    const linked = intent === "create-container"
      ? await createTagiooContainer(admin, {
        shop: session.shop,
        tenantId,
        fields: Object.fromEntries(["trackingDomain", "containerConfig", "ga4MeasurementId", "metaPixelId", "metaAccessToken"].map((key) => [key, form.get(key)])),
      })
      : await connectTagiooContainer({ shop: session.shop, tenantId, containerId: String(form.get("containerId") || "") });
    const connection = await saveConnection(admin, session.shop, linked);
    return { ok: true, message: "Tagioo tracking is connected.", connection, billing: billingView(connection, session.shop) };
  } catch (error) {
    console.error(`[Tagioo] ${intent} failed for ${session.shop}: ${error.message}`, error.cause || "");
    const message = isNetworkError(error) ? "Tagioo could not be reached just now. Please try again in a moment." : error.message;
    return { ok: false, error: message, failedIntent: intent };
  }
};

// Installs or updates the app pixel with the container's settings and stores
// the connection. Tagioo has already recorded this store on the container.
async function saveConnection(admin, shop, linked) {
  const shopResponse = await admin.graphql(`#graphql
    query ConnectShopId {
      shop {
        id
      }
    }
  `);
  const shopResult = await shopResponse.json();
  const shopId = shopResult.data?.shop?.id || null;
  const existing = await db.storeConnection.findUnique({ where: { shop } });
  await retainPrivacyRoute(existing);
  const pixel = await ensureWebPixel(admin, linked, existing?.pixelId || null);
  const fields = {
    shopId,
    tenantId: linked.tenantId,
    tenantName: linked.tenantName || null,
    trackingDomain: linked.trackingDomain,
    measurementId: linked.measurementId,
    integrationToken: linked.integrationToken,
    pixelId: pixel.id,
  };
  const connection = await db.storeConnection.upsert({
    where: { shop },
    create: { shop, ...fields },
    update: { ...fields, status: "connected", lastError: null },
  });
  await syncShopifyBilling(connection, { force: true }).catch(() => {});
  return db.storeConnection.findUnique({ where: { shop } });
}

const containerStatusText = {
  live: ["success", "Live"],
  http_live: ["success", "Live"],
  dns_pending: ["warning", "Waiting for DNS"],
  queued: ["info", "Starting"],
  pending_launch: ["info", "Starting"],
  launching: ["info", "Starting"],
  worker_assigned: ["info", "Starting"],
};

function containerBadge(status) {
  const [tone, label] = containerStatusText[status] || (status ? ["critical", "Needs attention"] : ["neutral", "Unknown"]);
  return <s-badge tone={tone}>{label}</s-badge>;
}

function hostOf(url) {
  return String(url || "").replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

export default function Index() {
  const initial = useLoaderData();
  const fetcher = useFetcher();
  const workspaceFetcher = useFetcher();
  const statusFetcher = useFetcher();
  const dnsFetcher = useFetcher();
  const templateFetcher = useFetcher();
  const unlinkFetcher = useFetcher();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const { workspace, dashboardUrl, signupUrl, loginUrl } = initial.tagioo;
  const connection = fetcher.data && Object.prototype.hasOwnProperty.call(fetcher.data, "connection")
    ? fetcher.data.connection
    : initial.connection;
  const billing = fetcher.data?.billing || initial.billing;
  const busyIntent = fetcher.state !== "idle" ? String(fetcher.formData?.get("intent") || "") : "";
  const containers = workspace.containers || [];
  const connectable = containers.filter((container) => container.connectable);
  const [addingContainer, setAddingContainer] = useState(false);
  // The plan decides how many containers a workspace may have (Free and
  // Starter: one). At the limit the form is replaced by an upgrade note.
  const canAddContainer = workspace.canAddContainer !== false;
  const showContainerForm = canAddContainer && (addingContainer || connectable.length === 0);

  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message);
    if (fetcher.data?.error) shopify.toast.show(fetcher.data.error, { isError: true });
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (workspaceFetcher.data?.message) shopify.toast.show(workspaceFetcher.data.message);
  }, [workspaceFetcher.data, shopify]);

  useEffect(() => {
    if (unlinkFetcher.data?.message) shopify.toast.show(unlinkFetcher.data.message);
    if (unlinkFetcher.data?.error) shopify.toast.show(unlinkFetcher.data.error, { isError: true });
  }, [unlinkFetcher.data, shopify]);

  // Linking happens on tagioo.com in another tab or window. After the merchant
  // opens one of those links, check every few seconds (and whenever this page
  // regains focus) until the workspace appears, so no manual reload is needed.
  // Focus also picks up a container added in the Tagioo dashboard.
  const revalidatorRef = useRef(revalidator);
  revalidatorRef.current = revalidator;
  const [awaitingLinkSince, setAwaitingLinkSince] = useState(0);
  const awaitLink = () => setAwaitingLinkSince(Date.now());
  useEffect(() => {
    if (connection) return undefined;
    const refresh = () => {
      if (revalidatorRef.current.state === "idle") revalidatorRef.current.revalidate();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refresh);
    const poll = awaitingLinkSince && !workspace.linked
      ? setInterval(() => {
        if (Date.now() - awaitingLinkSince > 15 * 60_000) setAwaitingLinkSince(0);
        else refresh();
      }, 4_000)
      : null;
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refresh);
      if (poll) clearInterval(poll);
    };
  }, [connection, workspace.linked, awaitingLinkSince]);
  useEffect(() => {
    if (!workspace.linked || !awaitingLinkSince) return;
    setAwaitingLinkSince(0);
    shopify.toast.show(`Linked to Tagioo workspace ${workspace.tenantName}`);
  }, [workspace.linked, workspace.tenantName, awaitingLinkSince, shopify]);

  // The connected container's launch state loads after the page, so opening
  // the app never waits on Tagioo.
  const statusSubmit = statusFetcher.submit;
  const connectedShop = connection?.shop || "";
  useEffect(() => {
    if (connectedShop) statusSubmit({ intent: "container-status" }, { method: "post" });
  }, [connectedShop, statusSubmit]);
  useEffect(() => {
    if (dnsFetcher.data?.dnsCheck) statusSubmit({ intent: "container-status" }, { method: "post" });
  }, [dnsFetcher.data, statusSubmit]);
  const containerStatus = statusFetcher.data?.containerStatus || null;
  const connectedContainer = containerStatus?.container || null;
  const dnsTarget = containerStatus?.dnsTarget || "";

  // Hand the template to the browser as a file the merchant imports into GTM.
  useEffect(() => {
    const result = templateFetcher.data?.serverTemplate;
    if (!result) return;
    if (result.error) {
      shopify.toast.show(result.error, { isError: true });
      return;
    }
    const blob = new Blob([JSON.stringify(result.template, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = result.fileName || "tagioo-server-template.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }, [templateFetcher.data, shopify]);

  useEffect(() => {
    if (unlinkFetcher.data?.unlinked && revalidatorRef.current.state === "idle") revalidatorRef.current.revalidate();
  }, [unlinkFetcher.data]);

  // Each dashboard link works once; fetch a fresh one after it is opened.
  const refreshDashboardLink = () => setTimeout(() => revalidator.revalidate(), 1500);
  const dashboardButton = dashboardUrl ? (
    <s-button href={dashboardUrl} target="_blank" variant={connection ? "primary" : "secondary"} onClick={refreshDashboardLink}>Open Tagioo dashboard</s-button>
  ) : null;
  const connectError = fetcher.data?.error && fetcher.data.failedIntent === "connect" ? fetcher.data.error : "";
  const createError = fetcher.data?.error && fetcher.data.failedIntent === "create-container" ? fetcher.data.error : "";

  return (
    <s-page heading="Tagioo Server-Side Tracking">
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
              <s-button type="submit" tone="critical" variant="secondary" {...(busyIntent === "disconnect" ? { loading: true } : {})}>Disconnect</s-button>
            </fetcher.Form>
            <s-text color="subdued">To use a different Tagioo account, disconnect this store first, then choose Use a different Tagioo account.</s-text>
          </s-stack>
        ) : (
          <s-stack direction="block" gap="base">
            {workspace.linked ? (
              <>
                <s-banner tone="success" heading={`Tagioo workspace: ${workspace.tenantName}`}>
                  {connectable.length
                    ? "Choose the tracking container for this store and click Connect. Tagioo then installs the app pixel and the paid-order webhook."
                    : "Add a tracking container for this store below. Tagioo then installs the app pixel and the paid-order webhook."}
                </s-banner>
                {containers.length ? (
                  <s-stack direction="block" gap="small-200">
                    {containers.map((container) => (
                      <s-box key={container.id || "primary"} padding="base" border="base" borderRadius="base">
                        <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
                          <s-stack direction="block" gap="small-300">
                            <s-text type="strong">{container.name}</s-text>
                            <s-text color="subdued">{hostOf(container.trackingDomain) || "No tracking domain yet"}{container.measurementId ? ` · ${container.measurementId}` : ""}</s-text>
                            {containerBadge(container.status)}
                          </s-stack>
                          {container.connectable ? (
                            <fetcher.Form method="post">
                              <input type="hidden" name="intent" value="connect" />
                              <input type="hidden" name="tenantId" value={workspace.tenantId} />
                              <input type="hidden" name="containerId" value={container.id} />
                              <s-button type="submit" variant="primary" {...(busyIntent === "connect" && fetcher.formData?.get("containerId") === container.id ? { loading: true } : {})}>Connect</s-button>
                            </fetcher.Form>
                          ) : (
                            <s-text color="subdued">{container.otherSiteLabel
                              ? `Set up for your ${container.otherSiteLabel} site`
                              : container.connectedShop ? `Used by ${container.connectedShop}` : "Finish its setup in the Tagioo dashboard"}</s-text>
                          )}
                        </s-stack>
                      </s-box>
                    ))}
                  </s-stack>
                ) : null}
                {connectError ? <s-banner tone="critical" heading="Could not connect">{connectError}</s-banner> : null}
                {showContainerForm ? (
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="create-container" />
                    <input type="hidden" name="tenantId" value={workspace.tenantId} />
                    <s-stack direction="block" gap="base">
                      <s-heading>Add a tracking container for this store</s-heading>
                      <s-paragraph>Tagioo hosts a Google Tag Manager server container for your store on your own subdomain, so tracking stays first-party.</s-paragraph>
                      <s-text-field
                        label="Tracking subdomain"
                        name="trackingDomain"
                        placeholder="track.yourstore.com"
                        details="A subdomain of your store's domain. After this step you add one DNS record that points it to Tagioo."
                        autocomplete="off"
                        required
                      />
                      <s-text-area
                        label="Server container config"
                        name="containerConfig"
                        rows={3}
                        details="In Google Tag Manager, open your server container, then Admin → Container settings → Manually provision tagging server, and copy the Container Config."
                        required
                      />
                      <s-text-field label="GA4 Measurement ID" name="ga4MeasurementId" placeholder="G-XXXXXXXXXX" autocomplete="off" required />
                      <s-text-field label="Meta Pixel ID (optional)" name="metaPixelId" autocomplete="off" />
                      <s-password-field label="Meta Conversions API access token (optional)" name="metaAccessToken" autocomplete="off" details="Needed with the Pixel ID to send events to Meta from the server." />
                      {createError ? <s-banner tone="critical" heading="Could not add the container">{createError}</s-banner> : null}
                      <s-stack direction="inline" gap="base">
                        <s-button type="submit" variant="primary" {...(busyIntent === "create-container" ? { loading: true } : {})}>Add container and connect</s-button>
                        {connectable.length ? <s-button variant="tertiary" onClick={() => setAddingContainer(false)}>Cancel</s-button> : null}
                      </s-stack>
                    </s-stack>
                  </fetcher.Form>
                ) : canAddContainer ? (
                  <s-button variant="tertiary" onClick={() => setAddingContainer(true)}>Add a new container for this store instead</s-button>
                ) : (
                  <s-banner tone={connectable.length ? "info" : "warning"} heading="Container limit reached">
                    Your Tagioo {workspace.plan || "current"} plan includes {workspace.containerLimit} {workspace.containerLimit === 1 ? "container" : "containers"}, and this workspace already uses {workspace.containersUsed}. To add a container for this store, choose a larger plan in Shopify.
                    {billing.enabled ? <> <s-link href={billing.planSelectionUrl} target="_top">View or change Shopify plan</s-link></> : null}
                  </s-banner>
                )}
                {dashboardButton}
                <unlinkFetcher.Form method="post">
                  <input type="hidden" name="intent" value="unlink" />
                  <input type="hidden" name="tenantId" value={workspace.tenantId} />
                  <s-paragraph>
                    Wrong workspace? <s-button type="submit" variant="tertiary" {...(unlinkFetcher.state !== "idle" ? { loading: true } : {})}>Use a different Tagioo account</s-button>
                  </s-paragraph>
                </unlinkFetcher.Form>
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
                  Already use Tagioo for other websites? <s-link href={loginUrl} target="_blank" onClick={awaitLink}>Sign in to link that account</s-link>. Its plan then moves to Shopify billing for all its sites.
                </s-paragraph>
              </>
            ) : (
              <>
                <s-banner tone="warning" heading="Tagioo could not be reached">
                  Reload the app in a moment. If you already have a Tagioo account, you can sign in now; this page updates when you come back.
                </s-banner>
                <s-stack direction="inline" gap="base">
                  <s-button href={signupUrl} target="_blank" variant="primary" onClick={awaitLink}>Create free Tagioo account</s-button>
                  <s-button href={loginUrl} target="_blank" onClick={awaitLink}>Sign in to Tagioo</s-button>
                </s-stack>
              </>
            )}
            <s-banner tone="info" heading="Billed through Shopify">
              Tagioo starts on the Free plan. Paid plans are chosen and billed only in Shopify; Tagioo never asks for a card.
            </s-banner>
            {billing.enabled ? <s-link href={billing.planSelectionUrl} target="_top">View or change Shopify plan</s-link> : null}
          </s-stack>
        )}
      </s-section>

      {connection ? (
        <s-section heading="Finish setup">
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small-200">
              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text type="strong">1. Tracking domain</s-text>
                {connectedContainer ? containerBadge(connectedContainer.status) : statusFetcher.state !== "idle" ? <s-spinner size="base" accessibilityLabel="Loading container status" /> : null}
              </s-stack>
              {connectedContainer?.status === "dns_pending" ? (
                <>
                  <s-paragraph>
                    At your domain provider, add a CNAME record for <s-text type="strong">{hostOf(connection.trackingDomain)}</s-text> that points to <s-text type="strong">{dnsTarget || "the target shown in your Tagioo dashboard"}</s-text>. Then check it here.
                  </s-paragraph>
                  <dnsFetcher.Form method="post">
                    <input type="hidden" name="intent" value="check-dns" />
                    <s-button type="submit" {...(dnsFetcher.state !== "idle" ? { loading: true } : {})}>Check DNS</s-button>
                  </dnsFetcher.Form>
                  {dnsFetcher.data?.dnsCheck?.message ? <s-text color="subdued">{dnsFetcher.data.dnsCheck.message}</s-text> : null}
                  {dnsFetcher.data?.dnsCheck?.error ? <s-banner tone="critical" heading="Could not check DNS">{dnsFetcher.data.dnsCheck.error}</s-banner> : null}
                </>
              ) : connectedContainer && !containerStatusText[connectedContainer.status] ? (
                <s-paragraph>Tagioo is finishing this container. If its status does not change within a few minutes, contact Tagioo support.</s-paragraph>
              ) : (
                <s-paragraph>{hostOf(connection.trackingDomain)} receives this store&apos;s events.</s-paragraph>
              )}
            </s-stack>
            <s-divider />
            <s-stack direction="block" gap="small-200">
              <s-text type="strong">2. Server container template</s-text>
              <s-paragraph>
                In Google Tag Manager, open your server container, choose Admin → Import container, select this file and choose Merge. Then publish the container. Skip this if you already imported Tagioo&apos;s server template from the Tagioo dashboard.
              </s-paragraph>
              <templateFetcher.Form method="post">
                <input type="hidden" name="intent" value="server-template" />
                <s-button type="submit" {...(templateFetcher.state !== "idle" ? { loading: true } : {})}>Download server container template</s-button>
              </templateFetcher.Form>
            </s-stack>
          </s-stack>
        </s-section>
      ) : null}

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
