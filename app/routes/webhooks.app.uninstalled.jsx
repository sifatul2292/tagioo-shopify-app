import { authenticateCleanupWebhook } from "../cleanup-webhook.server";
import db from "../db.server";
import { enqueueAppUninstall, enqueueStoreRelease } from "../order-delivery.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticateCleanupWebhook(request, "app/uninstalled");

  console.log(`Received ${topic} webhook for ${shop}`);

  const connection = await db.storeConnection.findUnique({ where: { shop } });
  if (connection) {
    await enqueueAppUninstall(connection);
  } else {
    // No connection here (a repeated delivery, or a disconnect that half
    // failed): still free any Tagioo container left tied to this store, and
    // remove any sessions Shopify left behind.
    await enqueueStoreRelease(shop);
  }

  return new Response();
};
