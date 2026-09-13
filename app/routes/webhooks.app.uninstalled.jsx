import { authenticate } from "../shopify.server";
import db from "../db.server";
import { enqueueAppUninstall } from "../order-delivery.server";

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const connection = await db.storeConnection.findUnique({ where: { shop } });
  if (connection) {
    await enqueueAppUninstall(connection);
  } else {
    // Repeated uninstall deliveries still remove any sessions Shopify left behind.
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
