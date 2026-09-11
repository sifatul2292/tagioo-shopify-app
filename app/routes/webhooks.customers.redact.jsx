import { authenticate } from "../shopify.server";
import { sendPrivacyEventToTagioo } from "../tagioo.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);
  await sendPrivacyEventToTagioo({ shop, payload, topic });
  return new Response();
};
