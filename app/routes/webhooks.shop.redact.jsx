import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteQueuedOrdersForShop } from "../order-delivery.server";
import { sendPrivacyEventToTagioo } from "../tagioo.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  await sendPrivacyEventToTagioo({ shop, payload, topic });
  await deleteQueuedOrdersForShop(shop);
  await db.storeConnection.deleteMany({ where: { shop } });
  await db.session.deleteMany({ where: { shop } });
  return new Response();
};
