# Tagioo Tracking — Shopify App Store submission

This is the prepared source copy for the English listing. Confirm every claim
against the live app before submission. The legal pages are operational drafts
and should receive legal review.

## Basic information

- App name: `Tagioo Tracking`
- Primary category: `Store management > Analytics`
- Languages: `English`
- App icon: `docs/app-store-assets/tagioo-app-icon.png`

## Listing copy

- Introduction (100 characters max):
  `Send storefront and paid-order events to your server-side analytics setup.`
- Details (500 characters max):
  `Tagioo connects storefront activity and paid Shopify orders to a merchant-owned server-side tracking workspace. Use the embedded setup flow to connect a Tagioo workspace, install the app pixel, and recover paid Purchase events from Shopify's backend. Matching order IDs help analytics and advertising destinations deduplicate browser and backend Purchase events.`
- Feature 1: `Track product, cart, checkout, and purchase events with an app pixel`
- Feature 2: `Recover paid Purchase events from Shopify's backend`
- Feature 3: `Deduplicate browser and backend purchases with matching order IDs`
- Subtitle (62 characters max): `Server-side storefront and paid-order tracking`
- Search terms: `analytics`, `conversion`, `tracking`, `web pixel`, `server-side`
- SEO title (60 characters max): `Tagioo Tracking: Server-side ecommerce analytics`
- SEO description (160 characters max):
  `Send storefront and paid-order events to a Tagioo server-side tracking workspace with app-pixel events, backend recovery, and purchase deduplication.`

## Install requirements

- Requires Shopify Online Store: `Yes`
- Requires Shopify POS: `No`
- Geographic restrictions: `None`

The Online Store requirement is selected because storefront customer events are
the app's primary source. Paid-order backend recovery still operates for
connected stores.

## Public URLs

- App URL: `https://connect.tagioo.com`
- Support URL: `https://tagioo.com/docs`
- Privacy URL: `https://tagioo.com/privacy`
- Terms URL: `https://tagioo.com/terms`

## Reviewer instructions

1. Install Tagioo Tracking on the Shopify development store used for review.
2. Sign in to the dedicated Tagioo reviewer account supplied in the listing.
3. Open Setup Assistant, create a container, choose Shopify, and enter a GA4
   Measurement ID and the assigned tracking domain.
4. Generate the Server GTM container template and import it into a Server GTM
   container using Merge. Do not publish the generated Web GTM browser tags for
   this Shopify store; the app pixel sends browser events.
5. Generate a one-time Shopify connection code in Tagioo.
6. Open Tagioo Tracking in Shopify Admin, paste the code, and connect.
7. Visit a product, add it to cart, and start checkout. Confirm those events in
   Tagioo Event Logs.
8. Place a test paid order. Confirm one backend Purchase appears and that the
   browser and backend Purchase share the Shopify order ID for deduplication.
9. Open `View or change Shopify plan` to inspect Free, Starter, Pro, and
   Enterprise plans. Development stores are not charged for plan testing.
10. Uninstall the app and confirm the store connection is removed.

## Still required before submission

- Upload the 1200 × 1200 app icon.
- Capture compliant screenshots without browser chrome or personal data.
- Record and host a 3–8 minute English screencast covering both the Tagioo
  customer flow and the embedded Shopify flow.
- Create a dedicated reviewer account that does not require Google SSO or 2FA.
- Add emergency contact details in the Partner account.
- Complete the protected-customer-data questionnaire truthfully. Do not claim
  encryption at rest, encrypted backups, production/test separation, DLP,
  access auditing, or an incident-response policy until each control is
  implemented and verified.
- Enable production Shopify billing only after the Partner API credentials are
  stored on the VPS and Free → paid → downgrade/cancel tests pass.
- Run Shopify's automated checks and resolve all failures.
- Select app capabilities and complete the AI self-review.
- Obtain confirmation immediately before saving/submitting listing content,
  protected-data responses, credentials, contact details, or the final review.
