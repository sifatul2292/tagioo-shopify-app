import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./billing.server.js", import.meta.url), "utf8");
const disconnectSource = source.slice(
  source.indexOf("const disconnectState"),
  source.indexOf("export function syncShopifyBilling"),
).replace("export ", "");

test("disconnect permits revoked tokens but preserves retryable failures", async () => {
  let failure;
  let sent;
  let calls = 0;
  let timeoutMs;
  const run = vm.runInNewContext(`${disconnectSource};disconnectShopifyBilling`, {
    setTimeout,
    shopifyBillingEnabled: () => true,
    sendBillingStateToTagioo: async (_connection, state, timeout) => {
      calls += 1;
      sent = state;
      timeoutMs = timeout;
      if (failure) throw failure;
    },
  });
  const disconnect = (connection) => run(connection, { retryDelayMs: 0 });
  assert.equal((await disconnect({ shop: "test.myshopify.com" })).disconnected, true);
  assert.equal(sent.status, "disconnected");
  // Tagioo may resize the container before answering, so the call gets 30 s.
  assert.equal(timeoutMs, 30_000);
  failure = Object.assign(new Error("Invalid Shopify integration signature."), { status: 401 });
  assert.equal((await disconnect({})).staleAuthorization, true);
  for (const status of [400, 403, 500, 503]) {
    failure = Object.assign(new Error("Upstream failed"), { status });
    calls = 0;
    await assert.rejects(disconnect({}), (error) => error === failure);
    assert.equal(calls, 1, "HTTP errors are not retried");
  }
  failure = new Error("Network timeout");
  calls = 0;
  await assert.rejects(disconnect({}), (error) => error === failure);
  assert.equal(calls, 2, "a dropped or slow call is retried once");
  assert.equal((await disconnect(null)).skipped, true);
});

test("a slow first disconnect call succeeds on the automatic retry", async () => {
  let calls = 0;
  const run = vm.runInNewContext(`${disconnectSource};disconnectShopifyBilling`, {
    setTimeout,
    shopifyBillingEnabled: () => true,
    sendBillingStateToTagioo: async () => {
      calls += 1;
      if (calls === 1) throw new Error("The operation was aborted due to timeout");
    },
  });
  assert.equal((await run({ shop: "test.myshopify.com" }, { retryDelayMs: 0 })).disconnected, true);
  assert.equal(calls, 2);
});
