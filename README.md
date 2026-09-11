# Tagioo Tracking for Shopify

Official Shopify app for connecting a Shopify store to an existing Tagioo server-side GTM workspace.

## What it does

- Installs a Shopify Web Pixel extension for page, product, cart, checkout, and browser Purchase events.
- Receives Shopify's signed `orders/paid` webhook and forwards a second, tenant-signed Purchase to Tagioo.
- Uses the Shopify order ID for both browser and backend Purchase so downstream Meta/GA4 tags can deduplicate.
- Keeps every store isolated with a unique integration token created from a short-lived Tagioo connection code.

## Local requirements

- Node.js 22.12+
- pnpm
- Shopify CLI login
- A Shopify development store
- A Tagioo test tenant with a tracking domain and GA4 Measurement ID

## Start locally

1. Copy `.env.example` to `.env` and add the Shopify app secret from the Partner/Dev Dashboard.
2. Install dependencies: `pnpm install`.
3. Prepare the local database: `pnpm setup`.
4. Start Shopify development mode: `pnpm dev`.
5. Install the development app on a Shopify development store.
6. In Tagioo Setup Assistant, select Shopify, generate the GTM templates, then generate a one-time Shopify connection code.
7. Paste the code into the embedded Tagioo Tracking app.

## Production configuration

Set these environment variables on the app host:

```env
SHOPIFY_API_KEY=your_shopify_client_id
SHOPIFY_API_SECRET=your_shopify_client_secret
SHOPIFY_APP_URL=https://your-app-host.example.com
SCOPES=read_orders,read_pixels,write_pixels,read_customer_events
TAGIOO_API_URL=https://tagioo.com
```

Do not commit `.env`, Shopify secrets, session databases, or tenant integration tokens.

The production app host is `https://connect.tagioo.com`. Persist
`prisma/dev.sqlite` on a private volume for a single-instance deployment; move
the Prisma datasource to a managed database before running multiple app instances.

Because the paid-order webhook uses customer contact and delivery details for
conversion matching, request Shopify protected customer data access before a
public App Store release. Development-store testing can be completed first.

Before releasing:

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm shopify app config validate --json
pnpm shopify app deploy
```

## Customer flow

1. Create/link the Tagioo Web and Server GTM containers.
2. In Tagioo Setup Assistant choose **Shopify** and enter the tracking details.
3. Generate/import `server.json` into Server GTM.
4. Install **Tagioo Tracking** from Shopify.
5. Generate a one-time connection code in Tagioo and paste it into the Shopify app.
6. Place one paid test order and verify Tagioo Event Logs, GA4 DebugView/Realtime, and Meta Test Events.

The app pixel replaces the Tagioo browser tags for Shopify. Do not simultaneously publish the generated `web.json` browser event tags, because that can produce duplicate browser events.
