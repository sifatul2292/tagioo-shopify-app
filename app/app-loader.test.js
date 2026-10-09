import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("app loader renders saved state without waiting for billing", async () => {
  const source = readFileSync(new URL("./routes/app._index.jsx", import.meta.url), "utf8");
  const loaderSource = source.slice(source.indexOf("export const loader"), source.indexOf("export const action")).replace("export ", "");
  const connection = { shop: "test.myshopify.com", shopId: "gid://shopify/Shop/123" };
  let syncing = false;
  const loader = vm.runInNewContext(`${loaderSource};loader`, {
    URL, console,
    authenticate: { admin: async () => ({ admin: {}, session: { shop: connection.shop } }) },
    db: { storeConnection: { findUnique: async () => connection } },
    billingView: () => ({ plan: "Free" }),
    syncShopifyBilling: () => { syncing = true; return new Promise(() => {}); },
  });
  const result = await Promise.race([
    loader({ request: { url: "https://app.example/app" } }),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("loader waited for billing")), 100); timer.unref(); }),
  ]);
  assert.equal(result.connection, connection);
  assert.equal(syncing, true);
});

test("plan approval return renders refreshed confirmed billing state", async () => {
  const source = readFileSync(new URL("./routes/app._index.jsx", import.meta.url), "utf8");
  const loaderSource = source.slice(source.indexOf("export const loader"), source.indexOf("export const action")).replace("export ", "");
  let connection = { shop: "test.myshopify.com", shopId: "gid://shopify/Shop/123", billingPlan: "Pro" };
  const loader = vm.runInNewContext(`${loaderSource};loader`, {
    URL, console,
    authenticate: { admin: async () => ({ admin: {}, session: { shop: connection.shop } }) },
    db: { storeConnection: { findUnique: async () => connection } },
    billingView: value => ({ plan: value.billingPlan }),
    syncShopifyBilling: async (_, { force }) => {
      assert.equal(force, true);
      await Promise.resolve();
      connection = { ...connection, billingPlan: "Starter" };
    },
  });
  const result = await loader({ request: { url: "https://app.example/app?plan_handle=starter" } });
  assert.equal(result.billing.plan, "Starter");
});
