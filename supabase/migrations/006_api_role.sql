-- Least-privilege database role for the API server. Apply after 005_throttling.sql.
-- The server no longer needs the service_role key (which bypasses RLS and reaches every table,
-- Storage object and Auth admin endpoint). It calls the Data API with a JWT whose role is
-- bank_api (SUPABASE_API_ROLE_TOKEN, see README and scripts/api-role-token.ts), and bank_api can
-- do exactly what the API does, nothing more (docs/database-access.md lists every account):
--   read the world document; read user roles; read and record session activity;
--   commit the world (compare-and-swap function) and use the request counters.
begin;

create role bank_api nologin noinherit;
grant bank_api to authenticator;
-- Same per-statement ceiling Supabase gives the authenticated role.
alter role bank_api set statement_timeout = '8s';

grant usage on schema public to bank_api;

grant select (id, data) on public.bank_world to bank_api;
create policy api_reads_world on public.bank_world for select to bank_api using (id = 1);

grant select (id, role) on public.profiles to bank_api;
create policy api_reads_roles on public.profiles for select to bank_api using (true);

grant select (session_id, actor, last_seen), insert (session_id, actor, last_seen),
  update (session_id, actor, last_seen) on public.session_activity to bank_api;
create policy api_reads_sessions on public.session_activity for select to bank_api using (true);
create policy api_records_sessions on public.session_activity for insert to bank_api with check (true);
create policy api_refreshes_sessions on public.session_activity for update to bank_api using (true) with check (true);

grant execute on function public.commit_bank_world(jsonb, bigint) to bank_api;
grant execute on function public.throttle_hit(text, integer, integer, integer) to bank_api;
grant execute on function public.throttle_wait(text) to bank_api;

-- New objects in public are not reachable by bank_api unless granted explicitly (no default
-- privileges are ever given to it).

-- The service key is operator tooling only (pnpm seed, the local demo reset) plus the local
-- development fallback: it keeps what those use and loses everything else on the app's tables
-- (no DELETE, TRUNCATE, REFERENCES or TRIGGER on the world, roles or sessions).
revoke all on public.bank_world, public.profiles, public.session_activity, public.request_limits
  from service_role;
grant select, insert, update on public.bank_world, public.profiles, public.session_activity
  to service_role;
grant select, delete on public.request_limits to service_role;
commit;
