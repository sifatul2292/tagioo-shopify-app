# Shopify protected-data operations — draft

Status: **not yet implemented or approved**. This document records the controls
Tagioo needs to operate before its protected-customer-data answers can be
changed to Yes. A written plan alone is not evidence that a control runs.

## Data and systems in scope

- Shopify app: paid-order webhook queue, app sessions, store connection tokens,
  and customer-redaction requests in `/var/lib/tagioo-shopify-app/dev.sqlite`.
- Tagioo panel: order records, event logs, customer accounts, local backups,
  and analytics destinations on the production VPS.
- Hostinger VPS backups and any manually exported database or log copies.
- Google Tag Manager, Google Analytics, Meta, TikTok, and other destinations
  explicitly selected by each merchant.

## Required controls and evidence

| Control | Current evidence | Completion proof needed |
| --- | --- | --- |
| Encrypt data at rest | Guest root filesystem is plain ext4; app and panel store plaintext records. Provider-level encryption is unverified. | Documented encryption covering all production stores, temporary files, logs, and keys; tested recovery. |
| Encrypt backups | Local JSON and SQLite backups are plaintext; Hostinger's VPS backup encryption has not been confirmed. | Encrypted backup configuration, key custody, and a successful restore test. |
| Separate test and production | Shopify development-store tests have used the production Tagioo service. | Separate app/service credentials and isolated test data; no production personal data copied into test. |
| Data-loss prevention | No verified export restrictions or review process. | Inventory export paths, restrict authorized operators, redact test artifacts, and verify access/alerting. |
| Staff passwords | The panel accepts eight-character customer passwords; owner and VPS access policy is unverified. | Enforced staff password/MFA policy across Shopify, Hostinger, VPS, and Tagioo, with a review record. |
| Access auditing | Server request and authentication logs exist, but a complete personal-data access trail is unverified. | Named operator identities, protected-data access logs, retention, and a sample audit review. |
| Incident response | No adopted policy or exercise has been verified. | Owner-approved procedure below, contacts, and a tabletop or test record. |

## Proposed incident procedure

1. Record discovery time, affected systems, reporter, and initial evidence in a
   restricted incident record. Avoid copying customer data into tickets or chat.
2. Contain access: disable affected credentials or integrations, isolate the
   affected service, and preserve logs and database snapshots. Keep unaffected
   tracking online where possible.
3. Identify the data, merchants, and period affected. Review access logs,
   application logs, deployment history, and backup access. Record uncertainty.
4. Restore from a verified clean version, rotate affected secrets, and validate
   order delivery, privacy webhooks, and purchase deduplication on test data.
5. The owner determines notice obligations to Shopify, merchants, customers,
   processors, and regulators with qualified legal advice; send required notices
   within applicable deadlines. Keep a record of decisions and timestamps.
6. Document cause, impact, remediation, and follow-up checks. Test the fix and
   review this procedure after each incident or exercise.

## Release rule

Do not mark Shopify's protected-data questionnaire Yes for an unverified
control. Do not submit the App Store review while the listing says the app does
not need protected customer data: paid-order webhooks and ad matching use it.
