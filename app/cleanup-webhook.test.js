import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { authenticateCleanupWebhook } from "./cleanup-webhook.server.js";

test("cleanup validates raw bytes without depending on revoked sessions", async () => {
  const oldSecret = process.env.SHOPIFY_API_SECRET;
  process.env.SHOPIFY_API_SECRET = "synthetic-test-secret";
  const body = '{"shop_domain":"cleanup-fixture.myshopify.com","name":"বাংলা"}';
  const signature = createHmac("sha256", process.env.SHOPIFY_API_SECRET).update(body).digest("base64");
  const request = (overrides = {}, payload = body) => new Request("https://fixture.invalid/webhook", {
    method: "POST", body: payload, headers: {
      "x-shopify-hmac-sha256": signature,
      "x-shopify-topic": "shop/redact",
      "x-shopify-shop-domain": "cleanup-fixture.myshopify.com", ...overrides,
    },
  });
  try {
    assert.equal((await authenticateCleanupWebhook(request(), "shop/redact")).topic, "SHOP_REDACT");
    for (const bad of ["", "invalid", "é".repeat(44)]) {
      await assert.rejects(authenticateCleanupWebhook(request({ "x-shopify-hmac-sha256": bad }), "shop/redact"), error => error.status === 401);
    }
    await assert.rejects(authenticateCleanupWebhook(request({}, body + " "), "shop/redact"), error => error.status === 401);
    await assert.rejects(authenticateCleanupWebhook(request({ "x-shopify-topic": "app/uninstalled" }), "shop/redact"), error => error.status === 400);
    await assert.rejects(authenticateCleanupWebhook(request({ "x-shopify-shop-domain": "another.invalid" }), "shop/redact"), error => error.status === 400);
  } finally {
    if (oldSecret === undefined) delete process.env.SHOPIFY_API_SECRET;
    else process.env.SHOPIFY_API_SECRET = oldSecret;
  }
});
