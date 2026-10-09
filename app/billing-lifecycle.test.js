import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('billing downgrade follows confirmed Shopify state and preserves paid access on missing state or outage', async () => {
  const source = readFileSync(new URL('./billing.server.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export function syncShopifyBilling('), source.indexOf('export function billingView(')).replaceAll('export ', '');
  let connection = { shop: 'fixture.myshopify.com', shopId: 'fixture', billingPlan: 'Pro' };
  let subscription, failure;
  const sent = [];
  const context = vm.createContext({
    CACHE_MS: 300000, MISSING_GRACE_MS: 86400000, pendingBillingSyncs: new Map(),
    shopifyBillingEnabled: () => true,
    fetchActiveSubscription: async () => { if (failure) throw failure; return { configured: true, subscription }; },
    planNameForSubscription: sub => sub?.plan || 'Free',
    subscriptionAmount: () => ({ amount: 0, currency: 'USD' }),
    sendBillingStateToTagioo: async (_c, state) => sent.push(state),
    db: { storeConnection: {
      update: async ({ data }) => { connection = { ...connection, ...data }; return connection; },
      updateMany: async ({ data }) => { connection = { ...connection, ...data }; },
    } },
  });
  vm.runInContext(body, context);
  const sync = async () => { context.connection = connection; return vm.runInContext('syncShopifyBilling(connection, { force: true })', context); };
  subscription = { plan: 'Starter' };
  assert.equal((await sync()).plan, 'Starter');
  assert.equal(connection.billingPlan, 'Starter');
  assert.equal(sent.at(-1).plan, 'Starter');
  subscription = { plan: 'Free' };
  assert.equal((await sync()).plan, 'Free');
  assert.equal(connection.billingPlan, 'Free');
  subscription = { plan: 'Pro' };
  await sync();
  const sentBefore = sent.length;
  subscription = null;
  assert.equal((await sync()).grace, true);
  assert.equal(connection.billingPlan, 'Pro');
  assert.equal(sent.length, sentBefore);
  failure = Error('Shopify unavailable');
  await assert.rejects(sync(), /Shopify unavailable/);
  assert.equal(connection.billingPlan, 'Pro');
  assert.equal(sent.length, sentBefore);
  failure = null;
  connection.billingMissingSince = new Date(Date.now() - 86400001);
  assert.equal((await sync()).plan, 'Free');
  assert.equal(sent.at(-1).plan, 'Free');
});
