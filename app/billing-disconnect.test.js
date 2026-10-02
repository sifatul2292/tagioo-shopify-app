import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./billing.server.js", import.meta.url), "utf8");
const disconnectSource = source.slice(
  source.indexOf("export async function disconnectShopifyBilling"),
  source.indexOf("export async function syncShopifyBilling"),
).replace("export ", "");

test("disconnect permits revoked tokens but preserves retryable failures", async () => {
  let failure;
  let sent;
  const disconnect = vm.runInNewContext(`${disconnectSource};disconnectShopifyBilling`, {
    shopifyBillingEnabled: () => true,
    sendBillingStateToTagioo: async (_connection, state) => {
      sent = state;
      if (failure) throw failure;
    },
  });
  assert.equal((await disconnect({ shop: "test.myshopify.com" })).disconnected, true);
  assert.equal(sent.status, "disconnected");
  failure = Object.assign(new Error("Invalid Shopify integration signature."), { status: 401 });
  assert.equal((await disconnect({})).staleAuthorization, true);
  for (const status of [400, 403, 500, 503]) {
    failure = Object.assign(new Error("Upstream failed"), { status });
    await assert.rejects(disconnect({}), (error) => error === failure);
  }
  failure = new Error("Network timeout");
  await assert.rejects(disconnect({}), (error) => error === failure);
  assert.equal((await disconnect(null)).skipped, true);
});
