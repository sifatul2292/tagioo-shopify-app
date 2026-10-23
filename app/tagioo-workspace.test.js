import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./tagioo.server.js", import.meta.url), "utf8");
const extract = (name) => {
  const start = source.search(new RegExp(`(export )?(async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}\n", start) + 3).replace(/^export /, "");
};
const secret = "s".repeat(40);

function context(extra = {}) {
  return vm.createContext({
    Buffer, URL, AbortSignal, JSON, Date, console, crypto,
    appSecret: secret,
    appSecretUsable: true,
    baseUrl: "https://tagioo.example",
    requestTimeoutMs: 10_000,
    dashboardLinkTtlMs: 9 * 60_000,
    ...extra,
  });
}

test("dashboard link carries a signed, short-lived, single-use claim for the store", () => {
  const ctx = context();
  vm.runInContext(extract("tagiooDashboardUrl"), ctx);
  const before = Date.now();
  const url = new URL(ctx.tagiooDashboardUrl("review-store.myshopify.com", "review"));
  assert.equal(url.origin + url.pathname, "https://tagioo.example/shopify/login");
  const [payload, signature] = url.searchParams.get("token").split(".");
  assert.equal(signature, crypto.createHmac("sha256", secret).update(payload).digest("hex"));
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(claims.shop, "review-store.myshopify.com");
  assert.equal(claims.tenantId, "review");
  assert.match(claims.nonce, /^[A-Za-z0-9_-]{16,64}$/);
  assert.ok(claims.exp > before && claims.exp <= Date.now() + 9 * 60_000);
  assert.notEqual(new URL(ctx.tagiooDashboardUrl("review-store.myshopify.com")).searchParams.get("token"), url.searchParams.get("token"));
});

test("no dashboard link without a usable shared secret", () => {
  const ctx = context({ appSecretUsable: false });
  vm.runInContext(extract("tagiooDashboardUrl"), ctx);
  assert.equal(ctx.tagiooDashboardUrl("review-store.myshopify.com"), "");
});

test("workspace calls are signed like the other Tagioo integration calls", async () => {
  let sent;
  const ctx = context({
    fetch: async (url, options) => {
      sent = { url, options };
      return { ok: false, status: 409, json: async () => ({ error: "A Tagioo account already uses owner@example.com.", code: "account_exists" }) };
    },
  });
  vm.runInContext(extract("signedTagiooPost"), ctx);
  await assert.rejects(
    ctx.signedTagiooPost("/api/integrations/shopify/workspace", { shop: "review-store.myshopify.com", intent: "create" }),
    (error) => error.code === "account_exists" && error.status === 409,
  );
  const { "x-tagioo-timestamp": timestamp, "x-tagioo-signature": signature } = sent.options.headers;
  assert.equal(sent.url, "https://tagioo.example/api/integrations/shopify/workspace");
  assert.equal(signature, crypto.createHmac("sha256", secret).update(`${timestamp}.${sent.options.body}`).digest("hex"));
});

test("an unreachable or unconfigured Tagioo falls back to the plain account links", async () => {
  const ctx = context({
    signedTagiooPost: async () => { throw new Error("fetch failed"); },
    console: { error: () => {} },
  });
  vm.runInContext(extract("fetchTagiooWorkspace"), ctx);
  assert.deepEqual({ ...(await ctx.fetchTagiooWorkspace("review-store.myshopify.com")) }, { available: false, linked: false });
  ctx.appSecretUsable = false;
  assert.equal((await ctx.fetchTagiooWorkspace("review-store.myshopify.com")).available, false);
});
