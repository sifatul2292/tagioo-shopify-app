const API_VERSION = "2026-07";

const planHandles = new Map([
  [process.env.SHOPIFY_PLAN_HANDLE_FREE || "free", "Free"],
  [process.env.SHOPIFY_PLAN_HANDLE_STARTER || "starter", "Starter"],
  [process.env.SHOPIFY_PLAN_HANDLE_PRO || "pro", "Pro"],
  [process.env.SHOPIFY_PLAN_HANDLE_ENTERPRISE || "enterprise", "Enterprise"],
]);

export function shopifyBillingEnabled() {
  return process.env.SHOPIFY_BILLING_ENABLED === "true";
}

export function shopifyPlanSelectionUrl(shop) {
  const storeHandle = String(shop || "").replace(/\.myshopify\.com$/i, "");
  const appHandle = process.env.SHOPIFY_APP_HANDLE || "tagioo-tracking";
  return `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/charges/${encodeURIComponent(appHandle)}/pricing_plans`;
}

export function planNameForSubscription(subscription) {
  if (!subscription) return "Free";
  for (const item of subscription.items || []) {
    const planName = planHandles.get(String(item.handle || "").toLowerCase());
    if (planName) return planName;
  }
  return "";
}

export async function fetchActiveSubscription(shopId) {
  const organizationId = process.env.SHOPIFY_PARTNER_ORG_ID || "";
  const accessToken = process.env.SHOPIFY_PARTNER_API_ACCESS_TOKEN || "";
  const appId = process.env.SHOPIFY_PARTNER_APP_ID || "";
  if (!shopifyBillingEnabled()) return { configured: false, subscription: null };
  if (!organizationId || !accessToken || !appId) throw new Error("Shopify Partner API billing credentials are incomplete.");

  const response = await fetch(`https://partners.shopify.com/${organizationId}/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "content-type": "application/json",
      "x-shopify-access-token": accessToken,
    },
    body: JSON.stringify({
      query: `#graphql
        query ActiveSubscription($appId: ID!, $shopId: ID!) {
          activeSubscription(appId: $appId, shopId: $shopId) {
            billingPeriod
            cancelAtEndOfCycle
            trialEndsAt
            currentBillingCycle { startTime endTime }
            items {
              handle
              price {
                __typename
                active
                currency
                ... on FlatRatePrice { amount }
              }
            }
          }
        }`,
      variables: { appId, shopId },
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.errors?.length) {
    throw new Error(result.errors?.[0]?.message || `Shopify Partner API returned HTTP ${response.status}.`);
  }
  return { configured: true, subscription: result.data?.activeSubscription || null };
}
