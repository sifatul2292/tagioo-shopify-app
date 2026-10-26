# Tagioo Server-Side Tracking for Shopify

Official Shopify app for connecting a Shopify store to a Tagioo server-side GTM workspace.

## What it does

- Installs a Shopify Web Pixel extension for page, product, cart, checkout, and browser Purchase events.
- Receives Shopify's signed `orders/paid` webhook, durably queues it in SQLite,
  and forwards a second, tenant-signed Purchase to Tagioo with background retries.
- Uses the Shopify order ID for both browser and backend Purchase so downstream Meta/GA4 tags can deduplicate.
- Keeps every store isolated with a unique integration token issued when the store connects.
- Connects with one click over a signed app-to-Tagioo channel (`TAGIOO_SHOPIFY_APP_SECRET`); there is no connection code.

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
6. Open the embedded app, create or link a Tagioo workspace, then click **Connect** next to a container
   (or add a container in the app). Set `TAGIOO_SHOPIFY_APP_SECRET` to the same value as the panel.

## Production configuration

Set these environment variables on the app host:

```env
SHOPIFY_API_KEY=your_shopify_client_id
SHOPIFY_API_SECRET=your_shopify_client_secret
SHOPIFY_APP_URL=https://your-app-host.example.com
SCOPES=read_orders,read_pixels,write_pixels,read_customer_events
TAGIOO_API_URL=https://tagioo.com
SHOPIFY_BILLING_ENABLED=false
SHOPIFY_APP_HANDLE=tagioo-tracking
SHOPIFY_PARTNER_ORG_ID=your_partner_organization_id
SHOPIFY_PARTNER_APP_ID=gid://shopify/App/your_numeric_app_id
SHOPIFY_PARTNER_API_ACCESS_TOKEN=your_partner_api_client_token
SHOPIFY_PLAN_HANDLE_FREE=free
SHOPIFY_PLAN_HANDLE_STARTER=starter
SHOPIFY_PLAN_HANDLE_PRO=pro
SHOPIFY_PLAN_HANDLE_ENTERPRISE=enterprise
```

Shopify billing remains disabled until managed pricing plans and matching plan
handles are configured in the Partner Dashboard. When enabled, connected stores
receive 15,000 events per rolling 30-day cycle for free. Reaching the limit pauses
tracking; the merchant must explicitly approve a paid Shopify plan to resume with
the paid limit. The app verifies that subscription through Shopify's Partner API
and signs the resulting entitlement update to Tagioo.

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
pnpm test
pnpm typecheck
pnpm build
pnpm shopify app config validate --json
pnpm shopify app deploy
```

## Customer flow

1. Install **Tagioo Server-Side Tracking** from Shopify.
2. In the app, create a free Tagioo workspace or sign in to link an existing one.
3. Click **Connect** next to a tracking container, or add one in the app (tracking subdomain,
   GTM server Container Config, GA4 Measurement ID, optional Meta Pixel and CAPI token).
4. Add the CNAME record shown in **Finish setup**, then download the server container template
   and import it into Server GTM (Merge), and publish.
5. Place one paid test order and verify Tagioo Event Logs, GA4 DebugView/Realtime, and Meta Test Events.

The app pixel replaces the Tagioo browser tags for Shopify. Do not simultaneously publish the generated `web.json` browser event tags, because that can produce duplicate browser events.
