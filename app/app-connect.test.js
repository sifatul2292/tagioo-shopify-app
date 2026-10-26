import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./routes/app._index.jsx", import.meta.url), "utf8");
const actionSource = source.slice(source.indexOf("export const action"), source.indexOf("// Installs or updates the app pixel")).replace("export ", "");
const saveSource = source.slice(source.indexOf("async function saveConnection"), source.indexOf("const containerStatusText"));

function harness({ connect, create } = {}) {
  const calls = { connect: [], create: [], pixel: [], upsert: [], unlink: [], failDisconnect: false };
  const rows = new Map();
  const linked = { tenantId: "review", tenantName: "Review", trackingDomain: "https://review-track.tagioo.example", measurementId: "G-REVIEW", integrationToken: "t".repeat(64) };
  const ctx = vm.createContext({
    console: { error: () => {} },
    authenticate: { admin: async () => ({
      admin: { graphql: async () => ({ json: async () => ({ data: { shop: { id: "gid://shopify/Shop/1" } } }) }) },
      session: { shop: "reviewer.myshopify.com" },
    }) },
    db: { storeConnection: {
      findUnique: async ({ where }) => rows.get(where.shop) || null,
      deleteMany: async ({ where }) => { rows.delete(where.shop); },
      upsert: async ({ where, create: created, update }) => {
        calls.upsert.push({ created, update });
        const row = { ...(rows.get(where.shop) || created), ...update };
        rows.set(where.shop, row);
        return row;
      },
    } },
    retainPrivacyRoute: async () => {},
    syncShopifyBilling: async () => {},
    billingView: () => ({ plan: "Free" }),
    ensureWebPixel: async (_admin, settings) => { calls.pixel.push(settings); return { id: "gid://shopify/WebPixel/1" }; },
    connectTagiooContainer: connect || (async (input) => { calls.connect.push(input); return linked; }),
    createTagiooContainer: create || (async (_admin, input) => { calls.create.push(input); return linked; }),
    isNetworkError: (error) => /fetch failed/.test(error.message),
    unlinkTagiooWorkspace: async (input) => { calls.unlink.push(input); if (input.tenantId === "connected") throw new Error("Disconnect this store from its Tagioo container first, then choose a different account."); return { unlinked: true }; },
    disconnectShopifyBilling: async () => { if (calls.failDisconnect) throw new Error("The operation was aborted due to timeout"); },
    deleteWebPixel: async () => {},
    deleteQueuedOrdersForShop: async () => {},
  });
  const action = vm.runInContext(`${actionSource}\n${saveSource}\n;action`, ctx);
  const run = (fields) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return action({ request: { formData: async () => form } });
  };
  return { run, calls, rows };
}

test("Connect links the chosen container and installs the pixel without any code", async () => {
  const { run, calls, rows } = harness();
  const result = await run({ intent: "connect", tenantId: "review", containerId: "setup_a" });
  assert.equal(result.ok, true);
  assert.deepEqual({ ...calls.connect[0] }, { shop: "reviewer.myshopify.com", tenantId: "review", containerId: "setup_a" });
  assert.equal(calls.pixel[0].trackingDomain, "https://review-track.tagioo.example");
  assert.equal(rows.get("reviewer.myshopify.com").pixelId, "gid://shopify/WebPixel/1");
  assert.equal(rows.get("reviewer.myshopify.com").shopId, "gid://shopify/Shop/1");
  assert.equal(result.connection.tenantId, "review");
});

test("a container added in the app is created and connected in one step", async () => {
  const { run, calls } = harness();
  const result = await run({ intent: "create-container", tenantId: "review", trackingDomain: "track.review.example", containerConfig: "cfg", ga4MeasurementId: "G-1", metaPixelId: "", metaAccessToken: "" });
  assert.equal(result.ok, true);
  assert.equal(calls.create[0].fields.trackingDomain, "track.review.example");
  assert.equal(calls.create[0].tenantId, "review");
  assert.equal(calls.pixel.length, 1);
});

test("failures say which step failed and never mention a connection code", async () => {
  const refused = harness({ connect: async () => { throw new Error("This Tagioo container is already connected to other.myshopify.com."); } });
  const result = await refused.run({ intent: "connect", tenantId: "review", containerId: "setup_b" });
  assert.equal(result.ok, false);
  assert.equal(result.failedIntent, "connect");
  assert.match(result.error, /already connected/);
  assert.equal(refused.calls.pixel.length, 0);
  const offline = harness({ create: async () => { throw new Error("fetch failed"); } });
  assert.match((await offline.run({ intent: "create-container" })).error, /could not be reached/);
  assert.doesNotMatch(source, /connectionCode|connection code/i);
});

test("Use a different Tagioo account unlinks the workspace and reports a refusal", async () => {
  const { run, calls } = harness();
  const done = await run({ intent: "unlink", tenantId: "review" });
  assert.equal(done.unlinked, true);
  assert.deepEqual({ ...calls.unlink[0] }, { shop: "reviewer.myshopify.com", tenantId: "review" });
  const refused = await run({ intent: "unlink", tenantId: "connected" });
  assert.equal(refused.unlinked, false);
  assert.match(refused.error, /Disconnect this store/);
});

test("a timed-out disconnect names Tagioo, not Shopify, and keeps the store connected", async () => {
  const { run, calls } = harness();
  await run({ intent: "connect", tenantId: "review", containerId: "setup_a" });
  calls.failDisconnect = true;
  const failed = await run({ intent: "disconnect" });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /^Tagioo did not answer in time, so the store is still connected\. Click Disconnect again\.$/);
  assert.equal(failed.connection.tenantId, "review");
  calls.failDisconnect = false;
  const ok = await run({ intent: "disconnect" });
  assert.equal(ok.ok, true);
  assert.equal(ok.connection, null);
});

test("the container form is hidden at the plan's container limit, with an upgrade note", () => {
  assert.match(source, /const showContainerForm = canAddContainer && \(addingContainer \|\| connectable\.length === 0\);/);
  assert.match(source, /heading="Container limit reached"/);
  assert.match(source, /choose a larger plan in Shopify/);
  assert.match(source, /Use a different Tagioo account/);
  // A container serving another website gets no Connect button, only a note.
  assert.match(source, /`Set up for your \$\{container\.otherSiteLabel\} site`/);
  assert.match(source, /\{container\.connectable \? \(/);
});

test("pages are sent complete, so React's stream helper never writes a stray $ into the page", () => {
  const entry = readFileSync(new URL("./entry.server.jsx", import.meta.url), "utf8");
  assert.match(entry, /const callbackName = "onAllReady";/);
  assert.doesNotMatch(entry, /onShellReady/);
});

test("Finish setup only lists open steps and hides once the container is live and set up", () => {
  assert.match(source, /const setupComplete = containerLive && Boolean\(connectedContainer\?\.setupDone\);/);
  assert.match(source, /\{connection && connectedContainer && !setupComplete \? \(\s*<s-section heading="Finish setup">/);
  assert.match(source, /\{connectedContainer\.setupDone \? null : \(/);
  assert.match(source, /Setup complete: /);
});

test("a plan change gets 30 s to reach Tagioo, which may resize the container first", () => {
  const billing = readFileSync(new URL("./billing.server.js", import.meta.url), "utf8");
  assert.match(billing, /await sendBillingStateToTagioo\(connection, state, 30_000\);/);
});
