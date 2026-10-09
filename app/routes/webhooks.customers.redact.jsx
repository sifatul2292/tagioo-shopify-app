import { authenticateCleanupWebhook } from "../cleanup-webhook.server";
import { deleteQueuedOrdersForCustomer } from "../order-delivery.server";
import { sendPrivacyEventToTagioo } from "../tagioo.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticateCleanupWebhook(request, "customers/redact");
  await sendPrivacyEventToTagioo({ shop, payload, topic });
  await deleteQueuedOrdersForCustomer(shop, payload);
  return new Response();
};
