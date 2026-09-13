import { authenticate } from "../shopify.server";
import { enqueueOrderDelivery } from "../order-delivery.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  try {
    await enqueueOrderDelivery({ shop, order: payload, topic });
  } catch (error) {
    console.error(`[Tagioo] could not queue ${topic} for ${shop}: ${error.message}`);
    return new Response("Tagioo delivery could not be queued", { status: 500 });
  }
  return new Response();
};
