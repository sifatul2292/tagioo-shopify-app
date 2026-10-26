import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./routes/app._index.jsx", import.meta.url), "utf8");
const actionSource = source.slice(source.indexOf("export const action"), source.indexOf("// Installs or updates the app pixel")).replace("export ", "");
const saveSource = source.slice(source.indexOf("async function saveConnection"), source.indexOf("const containerStatusText"));

function harness({ connect, create } = {}) {
  const calls = { connect: [], create: [], pixel: [], upsert: [] };
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
