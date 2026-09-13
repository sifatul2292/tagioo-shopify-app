import assert from "node:assert/strict";
import test from "node:test";
import { shopifyOrderId } from "./shopify-order-id.js";

test("normalizes browser and backend Shopify order IDs for deduplication", () => {
  assert.equal(shopifyOrderId({ id: 19038344806704 }), "19038344806704");
  assert.equal(shopifyOrderId({ admin_graphql_api_id: "gid://shopify/Order/19038344806704" }), "19038344806704");
});
