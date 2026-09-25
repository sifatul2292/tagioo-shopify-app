import assert from "node:assert/strict";
import test from "node:test";
import { orderDeliveryPayload } from "./shopify-order-payload.js";

test("queues only purchase delivery and customer-redaction fields", () => {
  const order = {
    id: 42,
    admin_graphql_api_id: "gid://shopify/Order/42",
    current_total_price: "12.00",
    email: "buyer@example.com",
    customer: { id: 7, email: "buyer@example.com", note: "private note" },
    billing_address: { city: "Dhaka", address1: "private street" },
    line_items: [{ product_id: 3, price: "12.00", quantity: 1, properties: [{ name: "secret" }] }],
    shipping_address: { address1: "private street" },
    payment_gateway_names: ["test"],
  };
  const payload = orderDeliveryPayload(order);
  assert.equal(payload.id, 42);
  assert.equal(payload.customer.id, 7);
  assert.equal(payload.billing_address.city, "Dhaka");
  assert.deepEqual(payload.line_items, [{ product_id: 3, variant_id: undefined, sku: undefined, name: undefined, title: undefined, price: "12.00", quantity: 1 }]);
  assert.equal(JSON.stringify(payload).includes("private"), false);
  assert.equal(JSON.stringify(payload).includes("payment_gateway_names"), false);
});
