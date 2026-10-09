import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { encodeProtectedPayload, decodeProtectedPayload } from './protected-payload.js';

const key = randomBytes(32).toString('base64');
const encode = value => encodeProtectedPayload(value, key);
const decode = value => decodeProtectedPayload(value, key);
function moduleFunctions(file, names, context) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '');
  return vm.runInNewContext(`${source};({${names}})`, context);
}

test('uninstall keeps encrypted privacy routes after sessions, active route and worker jobs disappear', async () => {
  const jobs = new Map();
  let active = { shop: 'test.myshopify.com', tenantId: 'test', integrationToken: 'secret-token', trackingDomain: 'https://test.example', pixelId: 'pixel' };
  let sessions = 1;
  function matches(job, where) {
    return (!where.shop || job.shop === where.shop)
      && (!where.topic || (typeof where.topic === 'string' ? job.topic === where.topic
        : where.topic.not ? job.topic !== where.topic.not : !where.topic.notIn.includes(job.topic)));
  }
  const db = {
    orderDelivery: {
      upsert: async ({ where, create, update }) => { jobs.set(where.id, jobs.has(where.id) ? { ...jobs.get(where.id), ...update } : create); },
      findMany: async ({ where }) => [...jobs.values()].filter(job => matches(job, where)),
      deleteMany: async ({ where }) => { for (const [id, job] of jobs) if (matches(job, where)) jobs.delete(id); },
      delete: async ({ where }) => { jobs.delete(where.id); },
    },
    storeConnection: { findUnique: async () => active, deleteMany: async () => { active = null; } },
    session: { deleteMany: async () => { sessions = 0; } },
    $transaction: async writes => Promise.all(writes),
  };
  const routing = moduleFunctions('./privacy-routing.server.js', 'privacyRouteWrite,retainPrivacyRoute,privacyConnections', { db, createHash, encodeProtectedPayload: encode, decodeProtectedPayload: decode });
  const worker = moduleFunctions('./order-delivery.server.js', 'enqueueAppUninstall,flushOrderDeliveries', {
    db, ...routing, encodeProtectedPayload: encode, decodeProtectedPayload: decode,
    disconnectShopifyBilling: async () => {}, sendOrderToTagioo: async () => {},
    orderDeliveryPayload: x => x, setInterval: () => ({ unref() {} }), setTimeout: () => ({ unref() {} }), console,
  });
  await worker.enqueueAppUninstall(active);
  await worker.flushOrderDeliveries();
  assert.equal(active, null);
  assert.equal(sessions, 0);
  assert.equal(jobs.size, 1);
  const archived = [...jobs.values()][0];
  assert.equal(archived.topic, 'PRIVACY_ROUTE');
  assert.equal(archived.payload.includes('secret-token'), false);
  assert.deepEqual(Object.keys(decode(archived.payload)), ['shop', 'tenantId', 'integrationToken']);
  const connections = await routing.privacyConnections('test.myshopify.com');
  assert.equal(connections.length, 1);
  assert.equal(connections[0].integrationToken, 'secret-token');
});
