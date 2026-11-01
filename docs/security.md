# Security Assessment

## Scope

ACME Bank is a fictional banking simulation. No real funds, payment rails, PAN/CVV or identity-verification documents are processed. The hosted version nevertheless processes email, profile and simulated financial records and must be secured as confidential data.

SD Elements project: **26**, ACME Bank - Digital Banking Simulation, under application AcmeBank. The survey is complete. The accepted requirement scope contains **335 controls**, including controls below the risk-policy threshold. Each requirement receives a Portuguese/English assessment ending with `RafahMarinho with Agentic AI`. Statuses distinguish implemented local protections from unverified provider configuration and operational requirements; incomplete is not a waiver.

Verified readback: **22 Complete, 15 Not Applicable, 298 Incomplete**. All 335 latest notes include both languages and the exact signature. The project is **not risk-policy compliant**. Not-applicable items concern unused session cookies, session rewriting, remote-code update mechanisms and MariaDB. Incomplete items require specific implementation, deployment evidence or testing; provider configuration must not be assumed secure by default.

## Trust Boundaries

The browser is untrusted. Supabase verifies credentials and TOTP. The Next.js API verifies bearer tokens, assurance level and protected profile role before returning customer-filtered data or applying mutations. Zod and the banking engine enforce ownership, roles, integer amounts, account funds and card limits. Role selection exists only in the explicitly fictional local demo.

SQL denies client access to the authoritative world. A server-only service key invokes an optimistic concurrency commit function. A durable audit table preserves simulation events across reset. These SQL permissions are written, not validated against a running PostgreSQL instance. The service key can bypass RLS and must never leave server-side configuration.

## Implemented Protections

- Server-side action validation and object/function authorization, backed by negative engine tests.
- Integer cents, fee confirmation, pending reservation, idempotent transfer retry, scheduled-payment state and card controls.
- Compare-and-swap version checks and per-user mutation throttling in SQL.
- Same-origin mutation check, JSON-only bodies, private no-store API responses and bounded retry loops.
- Escaped React text, no dynamic templates/raw HTML, parameterized Supabase calls, no arbitrary file paths or remote-fetch endpoint.
- Private statement object paths and restricted bucket policies; CSV formula neutralization and numeric export regression test.
- Mandatory hosted TOTP assurance and current-password verification before password change.
- Neutral login/registration/recovery errors, masked passwords, signup and onboarding consent.
- HSTS, frame denial, nosniff, restricted permissions, per-request nonce CSP with violation reporting and no framework-powered-by header.
- Versioned privacy notice; consent recorded server-side (items, notice version, language, verified identity, time) before personal data is collected, withdrawable in Settings and enforced before processing (notification feed, Storage policy for statement copies); restriction of simulations per customer; a new notice version requires a new decision (`src/services/privacy.ts`, `supabase/migrations/004_privacy.sql`).
- Email changes confirmed by Supabase Auth and propagated to the bank record by trigger and by the API; duplicate records removed and duplicate beneficiaries refused.
- Request throttling shared by all instances (per user, per client address, direct Storage uploads) with locks that double on repeat; Supabase Auth hooks lock accounts after repeated wrong passwords or TOTP codes (`005_throttling.sql`, `supabase/config.toml`).
- Session tokens encrypted at rest in the browser (AES-256-GCM, key from `/api/storage-key` held in memory only).
- The API server uses the least-privilege `bank_api` database role instead of the service key (`006_api_role.sql`, `docs/database-access.md`).
- `audit_events` is append-only for every role, chained with SHA-256 and verifiable; auditors get read-only reports (`007_audit_protection.sql`).
- Server start and stop and every read and commit of the bank record are logged on an `activity` channel (IDs, versions, action names; no personal data), next to the `security` channel.

## Locally Verified

`pnpm test` (61 unit and security checks) and `pnpm test:e2e` (10 browser checks in local demo mode) cover transfer reservation/idempotency/settlement, insufficient funds, foreign ownership, invalid amounts, role restrictions, reset UUID preservation, mass assignment, card freezing, scheduling, CSV formulas, reload persistence, both export formats, mobile width, customer navigation, sessions, headers, request limits, throttling, privacy consent and withdrawal, encrypted session storage and the database grants of the API role.

These checks are not a penetration test or hosted-auth/RLS integration test. Production build and TypeScript/lint checks are separate quality gates, not proof of compliance.

## Open Requirements

- Apply and negatively test the SQL migration with real Auth users: RLS, storage ownership, protected roles, CAS conflict and throttling.
- Verify hosted confirmation/recovery/SMTP/TOTP flows, provider password policy, rate limits and session revocation.
- Implement a concurrent-session policy.
- Configure production TLS, cloud identity controls, database network restrictions, encryption at rest, backups, restore drills, monitoring and secret rotation.
- Complete the privacy impact assessment and the record of processing with the privacy officer, legal review of the notice, deletion/retention, data localization and incident response.
- Complete independent code review, vulnerability scanning, dependency patch review and penetration testing.
- Add API failure/security-event auditing; current business audit events do not cover all failed authentication/authorization attempts.
- Replace the singleton JSONB world for a production ledger, add fraud/sanctions screening and least-privilege staff access.

The request body limit is checked after reading text; enforce an upstream body limit as well. Demo localStorage is not encrypted and is appropriate only for public fictional fixture data (development builds only). Auth tokens are stored encrypted; PKCE code verifiers, useless without the emailed one-time code, are not. No production deployment or live Supabase integration was performed.