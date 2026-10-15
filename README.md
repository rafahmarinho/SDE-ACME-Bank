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

1. Create a Supabase project and run the files in `supabase/migrations` in order (`001_bank.sql`, then `002_commit_where_clause.sql`) in its SQL editor.
2. Create `.env.local` using `.env.example`. Set the public URL and publishable key, server-only service-role key and a unique `DEMO_SEED_PASSWORD` of at least 12 characters. Never expose the service-role key in a `NEXT_PUBLIC_` variable.
3. Configure Auth: email confirmation, minimum password length 12, strong password policy, breached-password protection if available, TOTP MFA, email rate limits and production SMTP. Configure site URL and allowed redirect URLs for localhost and your production origin. Disable anonymous sign-in. Review provider session timeouts and administrative access.
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

`GET /api/bank` returns a role-filtered snapshot. `POST /api/bank` accepts the discriminated action schemas in `src/services/bank.ts`. Both require a verified `Authorization: Bearer <Supabase access token>` with TOTP `aal2`. Identity and role come from Auth and protected profiles, never request fields. POST requires JSON, rejects mismatched Origin, limits body size and rate-limits mutations to 30 per user/minute. Updates use a compare-and-swap SQL function and bounded retries; duplicate transfer keys cannot debit twice.

Only the server accesses the authoritative JSONB world through its service client. Customer data is filtered before leaving the server. Direct browser access to the world and role mutation are denied. Realtime exposes own profile revisions, not the full financial world. An append-only audit table retains events across simulation reset. Service-role access remains powerful and must be tightly controlled.

## Vercel Deployment

Import the repository into Vercel. If importing the parent workspace, set Root Directory to `acme-bank`. Use Node.js 22+, install `pnpm install --frozen-lockfile` and build `pnpm build`. Next.js deploys the UI and API together; no separate API service is needed.

Set Supabase environment variables in Vercel. `SUPABASE_SERVICE_ROLE_KEY` is server-only. Set `NEXT_PUBLIC_ENABLE_DEMO=false` and configure Supabase Auth redirects for the deployment origin. Do not set the seed password in the runtime deployment. Rebuild after changing public environment variables. Verify HTTPS, headers, redirects, SMTP delivery, MFA, RLS, Storage policies and realtime on the deployed environment. The CSP permits standard `*.supabase.co` domains; adjust it explicitly if using a custom Supabase domain.

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

Browser Auth tokens are managed by Supabase's browser client, not HttpOnly cookies. Explicit idle/absolute session enforcement and concurrent-session limits are not implemented here. CSP permits inline hydration scripts; a strict nonce CSP is a future hardening step. The current world uses a singleton JSONB document suitable for the bounded simulation, not large-scale banking. Staff have broad read access. There is no production payment screening, sanctions checking or fraud engine. Public registration consent does not replace legal review or a data-subject rights process.
