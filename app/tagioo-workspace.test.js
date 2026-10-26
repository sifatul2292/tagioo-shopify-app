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
    accountLinkTtlMs: 50 * 60_000,
    containerCreateTimeoutMs: 120_000,
    ...extra,
  });
}

test("dashboard link carries a signed, short-lived, single-use claim for the store", () => {
  const ctx = context();
  vm.runInContext(`${extract("signedAppToken")}\n${extract("tagiooDashboardUrl")}`, ctx);
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
  vm.runInContext(`${extract("signedAppToken")}\n${extract("tagiooDashboardUrl")}`, ctx);
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

test("shop details retry once after a dropped connection, never after a real error", async () => {
  const ctx = context({ setTimeout, console: { error: () => {} } });
  vm.runInContext(`${extract("isNetworkError")}\n${extract("loadShopDetails")}`, ctx);
  const admin = (failures, message = "Http request error, no response available: GraphQL Client: fetch failed") => {
    let calls = 0;
    return {
      calls: () => calls,
      graphql: async () => {
        calls += 1;
        if (calls <= failures) throw new Error(message);
        return { json: async () => ({ data: { shop: { name: "Review Store", email: "owner@example.com" } } }) };
      },
    };
  };
  const flaky = admin(1);
  assert.equal((await ctx.loadShopDetails(flaky, 0)).name, "Review Store");
  assert.equal(flaky.calls(), 2);
  const down = admin(5);
  await assert.rejects(ctx.loadShopDetails(down, 0), /fetch failed/);
  assert.equal(down.calls(), 2);
  const denied = admin(1, "Access denied for shop field");
  await assert.rejects(ctx.loadShopDetails(denied, 0), /Access denied/);
  assert.equal(denied.calls(), 1);
});

test("account links are signed start links that cannot sign anyone in", () => {
  const ctx = context();
  vm.runInContext(`${extract("signedAppToken")}\n${extract("tagiooAccountLinks")}`, ctx);
  const before = Date.now();
  const { signupUrl, loginUrl } = ctx.tagiooAccountLinks("review-store.myshopify.com");
  const signup = new URL(signupUrl);
  assert.equal(signup.origin + signup.pathname, "https://tagioo.example/shopify/start");
  assert.equal(signup.searchParams.has("shop"), false);
  const [payload, signature] = signup.searchParams.get("token").split(".");
  assert.equal(signature, crypto.createHmac("sha256", secret).update(payload).digest("hex"));
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(claims.shop, "review-store.myshopify.com");
  assert.equal(claims.purpose, "start");
  assert.equal(claims.tenantId, undefined);
  // Tagioo accepts start links for up to an hour.
  assert.ok(claims.exp > before && claims.exp <= Date.now() + 50 * 60_000);
  assert.equal(new URL(loginUrl).searchParams.get("account"), "existing");

  const unsigned = context({ appSecretUsable: false });
  vm.runInContext(`${extract("signedAppToken")}\n${extract("tagiooAccountLinks")}`, unsigned);
  assert.equal(unsigned.tagiooAccountLinks("review-store.myshopify.com").signupUrl, "https://tagioo.example/shopify/start?shop=review-store.myshopify.com");
});

test("workspace status passes the containers through", async () => {
  let sent;
  const ctx = context({
    signedTagiooPost: async (path, body) => {
      sent = body;
      return { linked: true, tenantId: "review", tenantName: "Review", containers: [{ id: "setup_a", connectable: true }], dnsTarget: "bd.tagioo.example" };
    },
  });
  vm.runInContext(extract("fetchTagiooWorkspace"), ctx);
  const workspace = await ctx.fetchTagiooWorkspace("review-store.myshopify.com", "review");
  assert.deepEqual({ ...sent }, { shop: "review-store.myshopify.com", tenantId: "review", intent: "status" });
  assert.equal(workspace.containers[0].id, "setup_a");
  assert.equal(workspace.dnsTarget, "bd.tagioo.example");
});

test("connect and create-container are signed calls with no connection code", async () => {
  const calls = [];
  const ctx = context({
    signedTagiooPost: async (path, body, timeoutMs) => { calls.push({ path, body, timeoutMs }); return { tenantId: "review" }; },
    loadShopDetails: async () => ({ name: "Review Store", primaryDomain: { url: "https://review.example" } }),
  });
  vm.runInContext([extract("requireAppLink"), extract("connectTagiooContainer"), extract("createTagiooContainer")].join("\n"), ctx);
  await ctx.connectTagiooContainer({ shop: "review-store.myshopify.com", tenantId: "review", containerId: "setup_a" });
  assert.deepEqual({ ...calls[0].body }, { shop: "review-store.myshopify.com", intent: "connect", tenantId: "review", containerId: "setup_a" });
  await ctx.createTagiooContainer({}, {
    shop: "review-store.myshopify.com",
    tenantId: "review",
    fields: { trackingDomain: " https://Track.Review.example/ ", containerConfig: " cfg ", ga4MeasurementId: "G-1", metaPixelId: "", metaAccessToken: "" },
  });
  const create = calls[1];
  assert.equal(create.path, "/api/integrations/shopify/workspace");
  assert.equal(create.timeoutMs, 120_000);
  assert.equal(create.body.intent, "create-container");
  assert.equal(create.body.trackingDomain, "track.review.example");
  assert.equal(create.body.containerConfig, "cfg");
  assert.equal(create.body.websiteUrl, "https://review.example");
  assert.equal(create.body.shopName, "Review Store");
  assert.ok(calls.every((call) => !("code" in call.body)));

  ctx.appSecretUsable = false;
  await assert.rejects(ctx.connectTagiooContainer({ shop: "review-store.myshopify.com" }), /not configured/);
});
