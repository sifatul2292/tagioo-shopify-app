import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { decodeProtectedPayload, encodeProtectedPayload } from "./protected-payload.js";

test("protects queued Shopify payloads and restores them", () => {
  const key = randomBytes(32).toString("base64");
  const payload = { email: "buyer@example.com", id: "gid://shopify/Order/1007" };
  const encoded = encodeProtectedPayload(payload, key);
  assert.equal(encoded.includes(payload.email), false);
  assert.deepEqual(decodeProtectedPayload(encoded, key), payload);
});

test("reads legacy plaintext queue rows during migration", () => {
  assert.deepEqual(decodeProtectedPayload(JSON.stringify({ id: 7 }), ""), { id: 7 });
});

test("rejects a wrong key", () => {
  const encoded = encodeProtectedPayload({ id: 7 }, randomBytes(32).toString("base64"));
  assert.throws(
    () => decodeProtectedPayload(encoded, randomBytes(32).toString("base64")),
    /could not be authenticated/
  );
});
