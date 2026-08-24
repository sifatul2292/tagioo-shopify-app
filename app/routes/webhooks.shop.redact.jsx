import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop } = await authenticate.webhook(request);
  await db.storeConnection.deleteMany({ where: { shop } });
  await db.session.deleteMany({ where: { shop } });
  return new Response();
};
