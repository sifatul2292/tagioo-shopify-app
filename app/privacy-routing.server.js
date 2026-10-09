import { createHash } from "node:crypto";
import db from "./db.server";
import { decodeProtectedPayload, encodeProtectedPayload } from "./protected-payload";

export function privacyRouteWrite(connection) {
  if (!connection?.integrationToken) return null;
  const { shop, tenantId, integrationToken } = connection;
  const id = `${shop}:privacy:${createHash("sha256").update(integrationToken).digest("hex")}`;
  const payload = encodeProtectedPayload({ shop, tenantId, integrationToken });
  return db.orderDelivery.upsert({
    where: { id },
    create: { id, shop, topic: "PRIVACY_ROUTE", payload },
    update: {},
  });
}

export async function retainPrivacyRoute(connection) {
  const write = privacyRouteWrite(connection);
  if (write) await write;
}

export async function privacyConnections(shop) {
  const [active, routes] = await Promise.all([
    db.storeConnection.findUnique({ where: { shop } }),
    db.orderDelivery.findMany({ where: { shop, topic: "PRIVACY_ROUTE" } }),
  ]);
  const connections = [...(active ? [active] : []), ...routes.map((route) => decodeProtectedPayload(route.payload))];
  return connections.filter((connection, index) => connections.findIndex((other) =>
    other.integrationToken === connection.integrationToken) === index);
}
