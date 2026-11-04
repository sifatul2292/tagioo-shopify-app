import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { decodeProtectedPayload, encodeProtectedPayload } from "./protected-payload.js";

// An uninstall used to free the store's Tagioo container only through the
// billing call, signed with the store's own token. When that token was stale
// (401) or the app had no connection for the store, the container stayed tied
// to a store that had left and no other store could connect to it.
const key = randomBytes(32).toString("base64");
const encode = (value) => encodeProtectedPayload(value, key);
const decode = (value) => decodeProtectedPayload(value, key);
const source = (file) => readFileSync(new URL(file, import.meta.url), "utf8");

function harness({ connection = null, billing = async () => ({ disconnected: true }), release = async () => ({ released: 1 }) } = {}) {
  const jobs = new Map();
  const calls = { billing: [], release: [] };
  let active = connection;
  const matches = (job, where) => (!where.shop || job.shop === where.shop)
    && (!where.topic || (typeof where.topic === "string" ? job.topic === where.topic
      : where.topic.not ? job.topic !== where.topic.not : !where.topic.notIn.includes(job.topic)));
  const db = {
    orderDelivery: {
      upsert: async ({ where, create, update }) => { jobs.set(where.id, jobs.has(where.id) ? { ...jobs.get(where.id), ...update } : { attempts: 0, ...create }); },
      findMany: async ({ where }) => [...jobs.values()].filter((job) => matches(job, where)),
      deleteMany: async ({ where }) => { for (const [id, job] of jobs) if (matches(job, where)) jobs.delete(id); },
      delete: async ({ where }) => { jobs.delete(where.id); },
      update: async ({ where, data }) => { jobs.set(where.id, { ...jobs.get(where.id), ...data }); },
    },
    storeConnection: {
      findUnique: async () => active,
      deleteMany: async () => { active = null; },
      updateMany: async () => {},
    },
    session: { deleteMany: async () => {} },
    $transaction: async (writes) => Promise.all(writes),
  };
  const worker = vm.runInNewContext(`${source("./order-delivery.server.js").replace(/^import .*;\n/gm, "").replace(/export /g, "")};({enqueueAppUninstall,enqueueStoreRelease,flushOrderDeliveries})`, {
    db, Date, console, setInterval: () => ({ unref() {} }), setTimeout: () => ({ unref() {} }),
    encodeProtectedPayload: encode, decodeProtectedPayload: decode,
    privacyRouteWrite: () => Promise.resolve(), orderDeliveryPayload: (order) => order, sendOrderToTagioo: async () => {},
    disconnectShopifyBilling: async (payload) => { calls.billing.push(payload); return billing(payload); },
    releaseStoreInTagioo: async (args) => { calls.release.push(args); return release(args); },
  });
  return { worker, jobs, calls, reconnect: (value) => { active = value; } };
}

const connection = { shop: "left.myshopify.com", tenantId: "review", integrationToken: "store-token", trackingDomain: "https://t.example" };

test("uninstall frees the store's Tagioo container even when its own token is stale", async () => {
  const { worker, jobs, calls } = harness({ connection, billing: async () => ({ disconnected: true, staleAuthorization: true }) });
  await worker.enqueueAppUninstall(connection);
  await worker.flushOrderDeliveries();
  assert.equal(calls.billing.length, 1);
  assert.equal(calls.billing[0].integrationToken, "store-token");
  assert.equal(calls.release.length, 1);
  assert.equal(calls.release[0].shop, "left.myshopify.com");
  assert.ok(!Number.isNaN(Date.parse(calls.release[0].before)));
  assert.equal(jobs.size, 0);
});

test("uninstall of a store the app has no connection for still frees its container", async () => {
  const { worker, jobs, calls } = harness();
  await worker.enqueueStoreRelease("left.myshopify.com");
  await worker.flushOrderDeliveries();
  // No store token to sign the billing call with: only the app-signed release.
  assert.equal(calls.billing.length, 0);
  assert.equal(calls.release.length, 1);
  assert.equal(calls.release[0].shop, "left.myshopify.com");
  assert.equal(jobs.size, 0);
});

test("a repeated uninstall delivery keeps the pending job that can still cancel billing", async () => {
  const { worker, jobs, calls } = harness({ connection, release: async () => { throw Object.assign(new Error("Tagioo is down"), { status: 503 }); } });
  await worker.enqueueAppUninstall(connection);
  await worker.enqueueStoreRelease("left.myshopify.com");
  assert.equal(decode([...jobs.values()][0].payload).integrationToken, "store-token");
  await worker.flushOrderDeliveries();
  // A failed release is retried later, not dropped.
  const job = [...jobs.values()][0];
  assert.equal(job.attempts, 1);
  assert.match(job.lastError, /Tagioo is down/);
  assert.equal(calls.release.length, 1);
});

test("an uninstall delivered after the store reconnected with the same link changes nothing", async () => {
  const { worker, calls, reconnect } = harness({ connection });
  await worker.enqueueAppUninstall(connection);
  reconnect({ ...connection });
  await worker.flushOrderDeliveries();
  assert.equal(calls.billing.length, 0);
  assert.equal(calls.release.length, 0);
});

test("Disconnect and the uninstall webhook both free the container in Tagioo", () => {
  const page = source("./routes/app._index.jsx");
  const disconnect = page.slice(page.indexOf('if (intent === "disconnect")'), page.indexOf('if (intent === "unlink")'));
  assert.match(disconnect, /await disconnectShopifyBilling\(existing\);\n\s+await releaseStoreInTagioo\(\{ shop: session\.shop, before: new Date\(\)\.toISOString\(\) \}\);/);
  const webhook = source("./routes/webhooks.app.uninstalled.jsx");
  assert.match(webhook, /await enqueueAppUninstall\(connection\);\n\s+\} else \{[\s\S]*await enqueueStoreRelease\(shop\);/);
  assert.match(source("./tagioo.server.js"), /signedTagiooPost\("\/api\/integrations\/shopify\/workspace", \{ shop, intent: "release", before \}\)/);
});
