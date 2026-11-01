# ACME Bank

A fictional digital banking workspace with customer, support and administrator roles. All UI, fixtures and reports are in English. No real money, card network, KYC or payment provider is connected.

## Local Demo

Requires Node.js 22+ and pnpm 10. Run commands from this directory:

```sh
pnpm install
pnpm dev
```

Open http://localhost:3000. Without Supabase configuration, development uses a local demo. The sidebar chooser switches between six customers, one support user and one administrator. Demo profiles have no passwords. All fixture names, emails and financial records are fictional.

Demo data persists in this browser's localStorage. Administrator Reset restores the fixture. Never enter real personal data into demo mode. Demo role selection is not authentication and must not be enabled for production.

For a local Supabase in Docker with the seed data (real sign-in and TOTP MFA) and the narrated demo videos, see [demo/README.md](demo/README.md).

## Supabase Setup

1. Create a Supabase project and run the files in `supabase/migrations` in order (`001` to `007`) in its SQL editor (or `supabase db push`). Apply them before deploying the matching app version: the API refuses requests while `session_activity` (003), the request counters (005) or the `bank_api` role (006) are missing.
2. Apply `supabase/config.toml` with `supabase config push` after setting `site_url` and the redirect URLs to your origin, or set the same values in the dashboard: email confirmation, password length 12 with mixed character classes, TOTP MFA, Auth rate limits, single-use links that expire after 15 minutes, secure email and password change, password and email change notifications, 12-hour sessions, anonymous sign-in off, and the `password_verification_attempt` and `mfa_verification_attempt` hooks (account lock-out; hosted availability depends on the plan). Configure production SMTP and breached-password protection if available.
3. Create `.env.local` using `.env.example`. The runtime needs the public URL and publishable key, `SUPABASE_API_ROLE_TOKEN` (run `pnpm api-role-token` with `SUPABASE_JWT_SECRET` set; it prints a JWT for the `bank_api` role, valid 30 days by default) and `SERVER_SECRET` (32+ random characters). The service key, JWT secret and `DEMO_SEED_PASSWORD` (12+ characters) are for operator tooling only. Never expose server values in a `NEXT_PUBLIC_` variable. `docs/database-access.md` lists what each database role may do.
4. Run `pnpm seed` once. The seed refuses to overwrite an existing world. If seed fails partially, review created Auth users before retrying; it is not a resumable migration.
5. Start the app, sign in and enroll a TOTP authenticator. Hosted banking API access requires assurance level `aal2`.

Fixture users share the password you supplied to the seed, not a hardcoded password:

| Role          | Emails                                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer      | alex.morgan@example.com, jordan.lee@example.com, taylor.brooks@example.com, sam.rivera@example.com, casey.chen@example.com, jamie.parker@example.com |
| Support       | support@example.com                                                                                                                                  |
| Administrator | admin@example.com                                                                                                                                    |

New confirmed users complete onboarding with zero opening funds. Administrator deposit scenarios add simulated funds. Seed accounts are for a controlled demonstration only; remove them before a real deployment.

## Banking Flows

Customers can inspect accounts and activity, filter/search transactions, manage beneficiaries, transfer after fee confirmation, schedule/cancel payments, freeze cards, change spending limits, download CSV/PDF statements, edit their profile and contact support. Support can view customer records and resolve tickets but cannot change money. Administrators additionally control scenarios, clock advancement, event inspection and fixture reset.

The fixture starts on October 12, 2026, with six customers and 360 transactions over the preceding 60 days. Amounts use integer USD cents. Transfer fees are 0.25%, minimum 25 cents. A pending transfer reserves principal and fee immediately; advancing the clock settles it once and credits matching internal accounts. External beneficiaries represent simulated destinations only. Scheduled payments execute on clock advancement and fail without overdrawing if funds are insufficient. Card purchases obey freeze status, monthly limit and available balance. Limits reset on crossing a calendar month.

CSV numeric amounts are cents; text cells are protected against formula injection. Statements exclude failed entries and identify pending entries. Hosted statement objects are private, scoped to the user's UUID and limited to PDF/CSV and 5 MB.

## Architecture And API

Next.js serves the web app and `/api/bank` API in one deployment. React, TypeScript, Tailwind and shadcn/ui implement the interface. Supabase provides email/password auth, PostgreSQL, private Storage and profile-change realtime notifications.

`GET /api/bank` returns a role-filtered snapshot. `POST /api/bank` accepts the discriminated action schemas in `src/services/bank.ts`. Both require a verified `Authorization: Bearer <Supabase access token>` with TOTP `aal2`. Identity and role come from Auth and protected profiles, never request fields. POST requires JSON, rejects mismatched Origin and refuses bodies over 8 KB before reading them in full. Requests are limited per user (120 reads and 30 mutations per minute) and invalid tokens per client address (10 per 5 minutes); going over locks the caller for a period that doubles on every repeat. Wrong passwords and TOTP codes lock the account in Supabase Auth with the same back-off (staff accounts after 3, customers after 5). Sessions lock after 15 minutes without activity and expire 12 hours after sign-in (customers can choose a shorter limit in Settings). Updates use a compare-and-swap SQL function and bounded retries; duplicate transfer keys cannot debit twice.

Only the server accesses the authoritative JSONB world, as the least-privilege `bank_api` database role. Customer data is filtered before leaving the server. Direct browser access to the world and role mutation are denied. Realtime exposes own profile revisions, not the full financial world. An append-only audit table retains events across simulation reset. The service key is for operator tooling (seed) only and is not part of the runtime environment.

## Vercel Deployment

Import the repository into Vercel. If importing the parent workspace, set Root Directory to `acme-bank`. Use Node.js 22+, install `pnpm install --frozen-lockfile` and build `pnpm build`. Next.js deploys the UI and API together; no separate API service is needed.

Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_API_ROLE_TOKEN` and `SERVER_SECRET` in Vercel; do not set the service key there. Rotate the role token before it expires. The local demo only runs under `pnpm dev` without Supabase settings; production builds never include it. Configure Supabase Auth redirects for the deployment origin. Do not set the seed password in the runtime deployment. Rebuild after changing public environment variables. Verify HTTPS, headers, redirects, SMTP delivery, MFA, RLS, Storage policies and realtime on the deployed environment. The per-request nonce CSP in `src/proxy.ts` allows connections only to the configured Supabase origin, which must use HTTPS.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

Browser checks use isolated browser contexts on port 3000 and reuse the local dev server if running. Do not run a production build/start concurrently with a dev server sharing the same `.next` output. Hosted Auth/SQL/Storage/realtime integration requires your Supabase project and is not verified by local fixture tests.

## Security And Production Limits

This is a banking simulation, not a certified banking platform. Review `docs/security.md` and the SDE assessment before any deployment. Hosted credentials were not provided during development, so SQL privileges and live integrations require execution and negative testing. Backups, monitoring, secret rotation, incident response, data retention/deletion, privacy procedures, deployment approvals and penetration testing remain operator responsibilities.

Browser Auth tokens are managed by Supabase's browser client in sessionStorage (PKCE flow), encrypted with AES-256-GCM under a per-browser key that `/api/storage-key` derives after authentication and the page keeps in memory only. Concurrent-session limits are not implemented here. The current world uses a singleton JSONB document suitable for the bounded simulation, not large-scale banking. Staff read customer identities, masked accounts with balances and the support queue, not ledger entries. There is no production payment screening, sanctions checking or fraud engine. Privacy choices (notice version, language, consents, restrictions and decision time) are recorded server-side, can be changed in Settings and are enforced before the related processing; this does not replace the privacy impact assessment, legal review or a data-subject rights process.
