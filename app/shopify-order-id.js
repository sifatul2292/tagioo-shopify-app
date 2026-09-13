export function shopifyOrderId(order = {}) {
  const value = String(order.id || order.admin_graphql_api_id || "");
  return value.replace(/^gid:\/\/shopify\/Order\//, "");
}
