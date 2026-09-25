# Shopify protected-data operations

Status: **adopted and in force**  
Effective date: 2026-09-25  
Owner: Tagioo owner/operator  
Review cycle: quarterly and after every security incident or material system change

## Scope and data flow

The Shopify app receives paid-order webhooks, minimizes each order to fields used
for conversion delivery and privacy requests, and queues the payload only until
successful delivery. Tagioo then stores the merchant's order data in the panel
for purchase recovery, reporting, customer-data requests, and redaction. The app
forwards data only to Tagioo and the analytics destinations selected by the
merchant. Tagioo does not use production personal data in development or tests.

Systems in scope are the Shopify app database, Tagioo panel database and
backups, production VPS, access-audit records, and configured analytics
processors. Shopify, Hostinger, Google, Meta, TikTok, and other merchant-selected
destinations are subprocessors or independent platforms as described in the
public privacy policy.

## Implemented controls and evidence

| Control | Implementation | Verification on 2026-09-25 |
| --- | --- | --- |
| Data minimization | `orderDeliveryPayload` keeps only purchase delivery and redaction fields. Queue rows are deleted after delivery. | Unit test confirms unrelated webhook fields are omitted. |
| Encryption in transit | Public Tagioo and Shopify app endpoints use HTTPS. App-to-Tagioo calls are HMAC signed and reject stale or altered requests. | Both production HTTPS endpoints returned 200 after deployment. |
| Encryption at rest | Panel `history.json` and snapshots use authenticated AES-256-GCM envelopes. Shopify order/uninstall queue payloads use AES-256-GCM. Keys are generated on the VPS, stored in root-owned mode-0600 environment files, and never committed. | Production panel, four panel snapshots, rollback copies, and legacy JSON copies all report `TAGIOO-PROTECTED-V2`. The running Shopify app reports its encryption key as configured. |
| Encrypted backups and recovery | Panel-created and release backups contain application-encrypted customer data. The migration decrypts every candidate into a checksum verifier before atomic replacement. Shopify SQLite backups contain no queued order rows; future queued rows are encrypted at the field level before SQLite writes. | Migration verified five active files plus three historical copies. Three inspected Shopify backup databases contained zero queued orders. |
| Test/production separation | Local staging listens on localhost, has its own data directory, owner credentials, and encryption key, and launches with production email, billing, worker, Shopify, and provisioning credentials absent. Synthetic data only is allowed. | Local staging returned 200, rejected an unauthenticated session with 401, and wrote an encrypted database. |
| Data-loss prevention | Protected fields are minimized; plaintext exports are prohibited; screenshots and test fixtures must be anonymized; backups and keys are root-only; production data is not copied to staging; privacy webhooks remove matching records; access is limited to the owner. | Large production and historical JSON stores were inventoried and encrypted. File modes are 0600. |
| Staff authentication | Production has one staff/owner login. Startup refuses the production password when it is shorter than 12 characters, common, or contains the username. Staff credentials must not be shared and must be rotated after role changes or suspected disclosure. MFA is required on external provider accounts wherever available. | Production restarted successfully with `REQUIRE_STRONG_STAFF_PASSWORDS=true`; the focused policy tests pass. |
| Access auditing | Shopify order writes, customer-data disclosures, redactions, shop redactions, and owner backup actions append a mode-0600 JSONL record. Tenant and record identifiers are HMAC-pseudonymized. | A production control-verification record was written and inspected without raw identifiers. |
| Retention and deletion | Queue rows are deleted after delivery. Valid Shopify customer/shop redaction webhooks remove matching data. Account data is deleted after the documented recovery period unless legal or security retention applies. | Redaction isolation tests and the live privacy route are present; public policy documents the schedule. |

## Access and DLP rules

1. Production access is limited to the owner/operator. Do not create shared staff
   credentials. Review Shopify, Hostinger, VPS, and Tagioo access quarterly.
2. Store secrets only in root-owned server environment files. Never place keys,
   tokens, passwords, customer records, or production logs in source control,
   chat, tickets, screenshots, or local staging.
3. Do not export production customer data. When support needs an example, build
   a synthetic reproduction or redact every identifier first.
4. Keep backups encrypted. Before copying or restoring a backup, verify its
   protected header, permissions, and checksum. Record backup actions in the
   protected-data audit log.
5. Investigate failed authentication, unexpected exports, privacy-webhook
   failures, and audit-log gaps as security events.

## Incident response procedure

1. Record discovery time, affected systems, reporter, and initial evidence in a
   restricted incident record. Do not copy customer data into tickets or chat.
2. Contain access by disabling affected credentials or integrations, isolating
   the affected service, and preserving audit/application logs. Keep unaffected
   tracking online where possible.
3. Identify the affected fields, merchants, customers, systems, and time range.
   Review protected-data audit logs, application logs, deployments, and backup
   access. Record uncertainty.
4. Eradicate the cause, rotate affected secrets, restore only from an
   authenticated encrypted backup, and validate order delivery, privacy
   webhooks, and purchase deduplication using synthetic data.
5. The owner assesses notification duties to Shopify, merchants, customers,
   processors, and regulators and obtains qualified legal advice where needed.
   Send required notices within the applicable deadlines and retain the decision
   record.
6. Document cause, impact, remediation, and follow-up tests. Update this policy
   and controls after the incident or exercise.

## Exercise record — 2026-09-25

A tabletop exercise modeled disclosure of a Shopify integration token. The
operator identified the affected tenant/container, used the documented
containment order (revoke connection, rotate the token, preserve pseudonymous
audit records), confirmed that unrelated tracking should stay online, and
identified the encrypted panel snapshot as the recovery source. The exercise
found that plaintext historical JSON backups had to be included in the
inventory; those copies were subsequently encrypted and verified. No production
credential was exposed or rotated during the exercise.

## Release rule

Do not answer a protected-data question Yes unless its implementation and
verification evidence remain current. Stop a release if encryption keys are
missing, a protected file is plaintext, access controls fail, or the privacy
routes no longer pass their tests.
