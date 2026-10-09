import { authenticateCleanupWebhook } from "../cleanup-webhook.server";
import db from "../db.server";
import { sendPrivacyEventToTagioo } from "../tagioo.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticateCleanupWebhook(request, "shop/redact");
  await sendPrivacyEventToTagioo({ shop, payload, topic });
  await db.orderDelivery.deleteMany({ where: { shop } });
  await db.storeConnection.deleteMany({ where: { shop } });
  await db.session.deleteMany({ where: { shop } });
  return new Response();
};
