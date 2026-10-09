import { createHmac, timingSafeEqual } from "node:crypto";

// Cleanup must remain possible after Shopify revokes the offline access token.
// Authenticate the raw webhook body without loading or refreshing a session.
export async function authenticateCleanupWebhook(request, expectedTopic) {
  if (request.method !== "POST") throw new Response(null, { status: 405 });
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Response(null, { status: 500 });
  const rawBody = Buffer.from(await request.arrayBuffer());
  const supplied = request.headers.get("x-shopify-hmac-sha256") || "";
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  if (Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    throw new Response(null, { status: 401 });
  }
  const topic = request.headers.get("x-shopify-topic");
  const shop = request.headers.get("x-shopify-shop-domain") || "";
  if (topic !== expectedTopic || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new Response(null, { status: 400 });
  }
  let payload;
  try { payload = JSON.parse(rawBody.toString("utf8")); } catch { throw new Response(null, { status: 400 }); }
  return { shop, payload, topic: topic.toUpperCase().replaceAll("/", "_") };
}
