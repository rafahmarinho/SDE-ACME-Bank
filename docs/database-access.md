# Database Access

Every account, role and process that touches the ACME Bank database, what it needs and what it may do. The grants and RLS policies in `supabase/migrations` implement exactly this table; anything not listed is denied. `tests/database-access.test.ts` fails when a migration grants the API role anything else.

## Accounts

| Account (who) | Used by | Credential |
| --- | --- | --- |
| `anon` | Browser before sign-in | Publishable key |
| `authenticated` | Browser after sign-in (Realtime, Storage) | User access token (TOTP `aal2` required by the policies) |
| `bank_api` | API server (`src/database/server.ts`) | `SUPABASE_API_ROLE_TOKEN`, a JWT for this role (`pnpm api-role-token`) |
| `supabase_auth_admin` | Supabase Auth (sign-in hooks, user triggers) | Managed by Supabase |
| `bank_auditor` | Auditors and report generation (read-only); granted to a named login by an operator | That login's credentials |
| `service_role` | Operator tooling only (`pnpm seed`, the local demo reset) and the API's local development fallback. Never in the production runtime environment | Service key |
| `postgres` | Migrations; owner of tables and `security definer` functions | Database password (operators) |

## Objects and permissions

| Object | anon | authenticated | bank_api | supabase_auth_admin | service_role (tooling) |
| --- | --- | --- | --- | --- | --- |
| `bank_world` (`id`, `data`: all customer and financial records) | none | none | SELECT `id`, `data`, row 1 only | via triggers only | SELECT, INSERT, UPDATE (seeding, demo reset); no DELETE or TRUNCATE |
| `profiles` (`id`, `role`, `revision`) | none | SELECT own row, `aal2` | SELECT `id`, `role` | via triggers only | SELECT, INSERT, UPDATE (role assignment at seeding); no DELETE or TRUNCATE |
| `session_activity` | none | none | SELECT, INSERT, UPDATE `session_id`, `actor`, `last_seen` (no DELETE) | none | SELECT, INSERT, UPDATE (development fallback only) |
| `audit_events` (append-only, SHA-256 hash chain) | none | none | none (written only by `commit_bank_world` and the sign-in and email triggers) | none | SELECT only (INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER revoked; changes refused by triggers for every role) |
| `request_limits` (legacy counter) | none | none | none | none | SELECT, DELETE (demo reset) |
| `api_throttle` | none | none | none (functions only) | none | none |
| `auth_lockouts`, `auth_lockout_policy` | none | none | none | none (hooks only) | none |
| Storage `statements` objects | none | INSERT and SELECT in own folder, `aal2`; INSERT also needs the statement-archive consent and the hourly quota | none | none | Supabase platform default for the service key (not used by the app) |
| `commit_bank_world()` | none | none | EXECUTE | none | EXECUTE |
| `throttle_hit()`, `throttle_wait()` | none | none | EXECUTE | none | EXECUTE |
| `consume_request()` (legacy) | none | none | none | none | EXECUTE |
| `audit_report()`, `audit_chain_broken_at()` (read-only) | none | none | none | none | EXECUTE |
| `hook_password_verification_attempt()`, `hook_mfa_verification_attempt()` | none | none | none | EXECUTE | none |
| `private.statement_archive_allowed()`, `private.statement_quota_available()` | none | EXECUTE (inside Storage policies) | none | none | none |
| `provision_customer()`, `private.sync_customer_email()`, `private.verification_attempt()`, `private.audit_*()` | none | none | none | trigger and hook internals | none |

`bank_auditor` may only EXECUTE `audit_report()` and `audit_chain_broken_at()`: no table, Storage or function access beyond those two read-only reports.

## Cells holding sensitive data

`bank_world.data` holds every customer's identity, privacy decisions and simulated ledger. Only `bank_api` reads it, and the API filters it per role and per field before anything leaves the server (`visibleState` in `src/services/bank.ts`, response schemas in `src/services/api-view.ts`): customers receive only their own records; support and administrators receive identities, masked account numbers, balances and the support queue, never ledger entries, cards, beneficiaries or privacy records.

## Operating rules

- The service key also carries Supabase's own administration rights (Auth admin API, Storage), which cannot be narrowed by grants: it stays with operators and out of the production runtime.
- The runtime environment holds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_API_ROLE_TOKEN` and `SERVER_SECRET`, never the service key. A production server refuses to start database work without the role token and refuses a token for any role other than `bank_api`.
- `bank_api` cannot log in, does not bypass RLS, and runs with an 8-second statement timeout.
- Rotate `SUPABASE_API_ROLE_TOKEN` before it expires (30 days by default, 90 at most).
