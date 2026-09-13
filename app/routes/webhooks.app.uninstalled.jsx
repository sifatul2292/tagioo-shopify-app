import { authenticate } from "../shopify.server";
import db from "../db.server";
import { disconnectShopifyBilling } from "../billing.server";
import { deleteQueuedOrdersForShop } from "../order-delivery.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }
  const connection = await db.storeConnection.findUnique({ where: { shop } });
  await disconnectShopifyBilling(connection);
  await deleteQueuedOrdersForShop(shop);
  await db.storeConnection.deleteMany({ where: { shop } });

  return new Response();
};
