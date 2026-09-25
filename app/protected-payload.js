import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import process from "node:process";

const PREFIX = "TAGIOO-PROTECTED-V1:";

function keyFrom(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const key = Buffer.from(text, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== text.replace(/=+$/, "")) {
    throw new Error("SHOPIFY_DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

export function encodeProtectedPayload(value, keyText = process.env.SHOPIFY_DATA_ENCRYPTION_KEY) {
  const key = keyFrom(keyText);
  if (!key) throw new Error("SHOPIFY_DATA_ENCRYPTION_KEY is required before protected payloads can be stored.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(PREFIX));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${PREFIX}${Buffer.from(JSON.stringify({
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  })).toString("base64")}`;
}

export function decodeProtectedPayload(value, keyText = process.env.SHOPIFY_DATA_ENCRYPTION_KEY) {
  const text = String(value || "");
  if (!text.startsWith(PREFIX)) return JSON.parse(text);
  const key = keyFrom(keyText);
  if (!key) throw new Error("SHOPIFY_DATA_ENCRYPTION_KEY is required to read protected payloads.");
  try {
    const envelope = JSON.parse(Buffer.from(text.slice(PREFIX.length), "base64").toString("utf8"));
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAAD(Buffer.from(PREFIX));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8"));
  } catch (error) {
    throw new Error(`Protected Shopify payload could not be authenticated: ${error.message}`);
  }
}
