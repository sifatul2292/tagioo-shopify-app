import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

export const loader = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export default function Auth() {
  const { errors } = useLoaderData();

  return (
    <AppProvider embedded={false}>
      <s-page>
        <s-section heading="Open Tagioo from Shopify Admin">
          <s-paragraph>Install or open Tagioo Tracking from Apps in your Shopify admin to continue.</s-paragraph>
          {errors.shop ? <s-banner tone="critical">{errors.shop}</s-banner> : null}
        </s-section>
      </s-page>
    </AppProvider>
  );
}
