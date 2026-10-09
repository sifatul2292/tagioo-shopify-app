import { authenticateCleanupWebhook } from "../cleanup-webhook.server";
import { sendPrivacyEventToTagioo } from "../tagioo.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticateCleanupWebhook(request, "customers/data_request");
  await sendPrivacyEventToTagioo({ shop, payload, topic });
  return new Response();
};
