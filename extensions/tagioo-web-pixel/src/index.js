import { register } from "@shopify/web-pixels-extension";

const clean = (value) => String(value ?? "").replace(/~/g, "").slice(0, 500);
const money = (price) => Number(price?.amount || price || 0);

register(({ analytics, settings, init }) => {
  const domain = String(settings.trackingDomain || "").replace(/\/$/, "");
  const measurementId = String(settings.measurementId || "");
  if (!domain || !measurementId) return;

  const send = async (eventName, event, details = {}) => {
    const params = new URLSearchParams({
      v: "2",
      tid: measurementId,
      cid: clean(event.clientId || "shopify"),
      en: eventName,
      _et: "1",
      dl: clean(event.context?.document?.location?.href || init?.context?.document?.location?.href || ""),
      dt: clean(event.context?.document?.title || ""),
      "ep.event_id": clean(details.eventId || event.id),
    });
    if (details.currency) params.set("cu", clean(details.currency));
    if (details.value !== undefined) params.set("epn.value", String(details.value));
    if (details.transactionId) params.set("ep.transaction_id", clean(details.transactionId));
    (details.items || []).slice(0, 20).forEach((item, index) => {
      const fields = [];
      if (item.id) fields.push(`id${clean(item.id)}`);
      if (item.name) fields.push(`nm${clean(item.name)}`);
      if (item.price) fields.push(`pr${money(item.price)}`);
      if (item.quantity) fields.push(`qt${Number(item.quantity)}`);
      if (fields.length) params.set(`pr${index + 1}`, fields.join("~"));
    });
    await fetch(`${domain}/g/collect?${params.toString()}`, {
      method: "POST",
      mode: "no-cors",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: "",
      keepalive: true,
    });
  };

  const lineItem = (line) => ({
    id: line?.merchandise?.product?.id || line?.merchandise?.id,
    name: line?.merchandise?.product?.title || line?.merchandise?.title,
    price: line?.cost?.totalAmount || line?.cost?.amountPerQuantity,
    quantity: line?.quantity || 1,
  });
  const checkoutDetails = (event) => {
    const checkout = event.data?.checkout || {};
    return {
      value: money(checkout.totalPrice || checkout.subtotalPrice),
      currency: checkout.currencyCode || checkout.totalPrice?.currencyCode,
      items: (checkout.lineItems || []).map(lineItem),
    };
  };

  analytics.subscribe("page_viewed", (event) => send("page_view", event));
  analytics.subscribe("product_viewed", (event) => {
    const variant = event.data?.productVariant;
    return send("view_item", event, {
      value: money(variant?.price),
      currency: variant?.price?.currencyCode,
      items: [{ id: variant?.product?.id || variant?.id, name: variant?.product?.title || variant?.title, price: variant?.price, quantity: 1 }],
    });
  });
  analytics.subscribe("product_added_to_cart", (event) => {
    const line = event.data?.cartLine;
    return send("add_to_cart", event, {
      value: money(line?.cost?.totalAmount),
      currency: line?.cost?.totalAmount?.currencyCode,
      items: [lineItem(line)],
    });
  });
  analytics.subscribe("checkout_started", (event) => send("begin_checkout", event, checkoutDetails(event)));
  analytics.subscribe("checkout_shipping_info_submitted", (event) => send("add_shipping_info", event, checkoutDetails(event)));
  analytics.subscribe("payment_info_submitted", (event) => send("add_payment_info", event, checkoutDetails(event)));
  analytics.subscribe("checkout_completed", (event) => {
    const details = checkoutDetails(event);
    const orderId = String(event.data?.checkout?.order?.id || event.data?.checkout?.order?.name || event.id);
    return send("purchase", event, { ...details, eventId: orderId, transactionId: orderId });
  });
});
