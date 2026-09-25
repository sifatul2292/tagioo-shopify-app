# Shopify App Store AI self-review — 2026-09-25

The canonical requirements were fetched with Shopify CLI from
`app-store-ai-self-review-requirements` on 2026-09-25 and checked against this
repository. Shopify will still review these and other requirements during the
official App Store review.

## Summary

- Likely passing: **29**
- Likely failing: **0**
- Needs review: **2**
- Groups skipped as not applicable or opt-in: **10**

The app configuration validates. Unit tests, lint, typecheck, and the production
build pass under Node 22. The development store also completed a live managed
pricing Free → Starter → Free flow and a paid-order test whose browser and
backend Purchase copies deduplicated to one unique Purchase.

## Requirements that need review

### 1.2.2 Implement Shopify App Pricing or the Shopify Billing API correctly

Shopify Managed Pricing is configured, paid-plan approval and downgrade to Free
were tested, and the embedded app refreshed both states. A merchant-declined
approval and a fresh paid-plan approval after uninstall/reinstall have not been
observed end to end.

### 2.3.4 Require OAuth authentication immediately after reinstall

The app uses Shopify's React Router authentication/session storage and has no
manual shop-domain login. A full uninstall/reinstall was not performed in this
release verification because it would remove the currently prepared reviewer
connection. Shopify's reviewer can exercise the documented uninstall step.

## Skipped groups

- **5.1 Online store** — no theme app extension; the app uses a web pixel.
- **5.2 Payment** — no payment extension or payment-gateway scopes.
- **5.3 Payment facilitator** — opt-in review not requested.
- **5.4 Purchase option** — no subscription or payment-mandate scopes.
- **5.5 Product sourcing** — opt-in review not requested.
- **5.6 Checkout customization** — no checkout UI extension.
- **5.7 Sales channel** — no channel extension.
- **5.8 Post purchase** — no post-purchase extension.
- **5.9 Mobile app builders** — opt-in review not requested.
- **5.10 Donation** — opt-in review not requested.

## Separate submission blocker

The protected-customer-data request is still a draft and cannot be represented
as approved. The app uses paid-order name, email, phone, address, IP, and user
agent data for analytics and advertising matching. Seven data-protection
controls remain answered No until they are implemented and verified: encryption
at rest, encrypted backups, test/production data separation, data-loss
prevention, strong staff password requirements, personal-data access logging,
and an adopted incident-response policy.

