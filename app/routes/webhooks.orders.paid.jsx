import { authenticate } from "../shopify.server";
import db from "../db.server";
import { sendOrderToTagioo } from "../tagioo.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  try {
    await sendOrderToTagioo({ shop, order: payload, topic });
  } catch (error) {
    console.error(`[Tagioo] ${topic} for ${shop} failed: ${error.message}`);
    await db.storeConnection.updateMany({ where: { shop }, data: { lastError: error.message } });
    return new Response("Tagioo delivery failed", { status: 500 });
  }
  return new Response();
};
