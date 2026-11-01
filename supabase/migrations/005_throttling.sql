-- Request throttling and authentication lock-out. Apply after 004_privacy.sql.
-- 1. api_throttle: counters shared by every server instance, keyed by user, route or pseudonymous
--    client address. Going over a limit locks the key for a set period that doubles on every
--    repeat (capped at 24 hours) and decays after a quiet day.
-- 2. Direct statement uploads to Storage: at most 20 per customer per hour.
-- 3. Supabase Auth hooks that lock an account after repeated wrong passwords or TOTP codes, with an
--    exponentially growing wait. Staff (system) accounts lock sooner than customers. Enable them in
--    supabase/config.toml ([auth.hook.*]) or the dashboard (Authentication > Hooks).
begin;

create table public.api_throttle (
  bucket text primary key check (length(bucket) <= 200),
  window_start timestamptz not null,
  hits integer not null,
  strikes integer not null default 0,
  locked_until timestamptz
);
alter table public.api_throttle enable row level security;
revoke all on public.api_throttle from anon, authenticated, service_role;

-- Counts one request for `key`; returns the seconds the caller must wait (0 = allowed).
-- Requests made while locked are refused without being counted.
create function public.throttle_hit(key text, max_hits integer, window_seconds integer, lock_seconds integer)
returns integer
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  counter_row public.api_throttle;
begin
  if key is null or length(key) > 200 or max_hits < 1 or window_seconds < 1 or lock_seconds < 1 then
    raise exception 'Invalid throttle request';
  end if;
  select * into counter_row from public.api_throttle where bucket = key for update;
  if counter_row.locked_until > now() then
    return ceil(extract(epoch from counter_row.locked_until - now()))::integer;
  end if;
  insert into public.api_throttle as counter (bucket, window_start, hits) values (key, now(), 1)
  on conflict (bucket) do update set
    hits = case when counter.window_start < now() - make_interval(secs => window_seconds) then 1 else counter.hits + 1 end,
    window_start = case when counter.window_start < now() - make_interval(secs => window_seconds) then now() else counter.window_start end,
    -- A day without a lock forgives earlier strikes.
    strikes = case when counter.locked_until < now() - interval '24 hours' then 0 else counter.strikes end
  returning * into counter_row;
  if counter_row.hits <= max_hits then return 0; end if;
  update public.api_throttle set
    strikes = least(counter_row.strikes + 1, 20),
    hits = 0,
    window_start = now(),
    locked_until = now() + least(make_interval(secs => lock_seconds * power(2, least(counter_row.strikes, 16))), interval '24 hours')
  where bucket = key
  returning locked_until into counter_row.locked_until;
  return ceil(extract(epoch from counter_row.locked_until - now()))::integer;
end;
$$;

-- Seconds left on an active lock for `key`, without counting a request.
create function public.throttle_wait(key text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select greatest(ceil(extract(epoch from locked_until - now())), 0)::integer
    from public.api_throttle where bucket = key and locked_until > now()
  ), 0);
$$;
revoke all on function public.throttle_hit(text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.throttle_wait(text) from public, anon, authenticated;
grant execute on function public.throttle_hit(text, integer, integer, integer) to service_role;
grant execute on function public.throttle_wait(text) to service_role;

-- Statement uploads go straight from the browser to Storage, so they are limited in the policy:
-- at most 20 statement copies per customer per hour (on top of the 5 MB and file type limits).
create function private.statement_quota_available() returns boolean
language sql stable security definer set search_path = '' as $$
  select count(*) < 20 from storage.objects
  where bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text
    and created_at > now() - interval '1 hour';
$$;
revoke all on function private.statement_quota_available() from public, anon;
grant execute on function private.statement_quota_available() to authenticated;
drop policy private_statements_insert on storage.objects;
create policy private_statements_insert on storage.objects for insert to authenticated
with check (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text
  and (auth.jwt() ->> 'aal') = 'aal2' and private.statement_archive_allowed()
  and private.statement_quota_available());

-- Authentication lock-out. Thresholds and waits are configuration, not code.
create table public.auth_lockout_policy (
  id boolean primary key default true check (id),
  customer_threshold integer not null default 5 check (customer_threshold between 1 and 20),
  staff_threshold integer not null default 3 check (staff_threshold between 1 and 20),
  base_lock_seconds integer not null default 60 check (base_lock_seconds >= 1),
  max_lock_seconds integer not null default 86400 check (max_lock_seconds >= base_lock_seconds)
);
insert into public.auth_lockout_policy default values;
alter table public.auth_lockout_policy enable row level security;
revoke all on public.auth_lockout_policy from anon, authenticated, service_role;

create table public.auth_lockouts (
  user_id uuid not null references auth.users(id) on delete cascade,
  factor text not null check (factor in ('password', 'totp')),
  failures integer not null default 0,
  last_failure timestamptz,
  locked_until timestamptz,
  primary key (user_id, factor)
);
alter table public.auth_lockouts enable row level security;
revoke all on public.auth_lockouts from anon, authenticated, service_role;

-- Shared decision for both hooks. While locked, even a correct secret is refused; a success
-- outside a lock clears the counter; each failure from the threshold on doubles the wait.
create function private.verification_attempt(subject uuid, kind text, valid boolean) returns text
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  rules public.auth_lockout_policy;
  attempt public.auth_lockouts;
  threshold integer;
begin
  if subject is null then return 'continue'; end if;
  select * into rules from public.auth_lockout_policy;
  select * into attempt from public.auth_lockouts where user_id = subject and factor = kind for update;
  if attempt.locked_until > now() then return 'locked'; end if;
  if valid then
    delete from public.auth_lockouts where user_id = subject and factor = kind;
    return 'continue';
  end if;
  threshold := case when exists (select 1 from public.profiles where id = subject and role in ('support', 'administrator'))
    then rules.staff_threshold else rules.customer_threshold end;
  insert into public.auth_lockouts as lockout (user_id, factor, failures, last_failure) values (subject, kind, 1, now())
  on conflict (user_id, factor) do update set
    failures = case when lockout.last_failure < now() - interval '24 hours' then 1 else lockout.failures + 1 end,
    last_failure = now()
  returning * into attempt;
  if attempt.failures >= threshold then
    update public.auth_lockouts set locked_until = now() + least(
      make_interval(secs => rules.base_lock_seconds * power(2, least(attempt.failures - threshold, 16))),
      make_interval(secs => rules.max_lock_seconds))
    where user_id = subject and factor = kind;
    insert into public.audit_events(id, actor, event_time, message)
    values (gen_random_uuid(), subject::text, now(), format('Sign-in locked after %s failed %s attempts', attempt.failures, kind));
  end if;
  return 'continue';
end;
$$;
revoke all on function private.verification_attempt(uuid, text, boolean) from public, anon, authenticated;

create function public.hook_password_verification_attempt(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if private.verification_attempt((event->>'user_id')::uuid, 'password', (event->>'valid')::boolean) = 'locked' then
    return jsonb_build_object('decision', 'reject',
      'message', 'Too many failed attempts. Wait a while before trying again.', 'should_logout_user', false);
  end if;
  return jsonb_build_object('decision', 'continue');
end;
$$;

create function public.hook_mfa_verification_attempt(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if private.verification_attempt((event->>'user_id')::uuid, 'totp', (event->>'valid')::boolean) = 'locked' then
    return jsonb_build_object('decision', 'reject',
      'message', 'Too many failed codes. Wait a while before trying again.');
  end if;
  return jsonb_build_object('decision', 'continue');
end;
$$;
revoke all on function public.hook_password_verification_attempt(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.hook_mfa_verification_attempt(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin;
grant execute on function public.hook_mfa_verification_attempt(jsonb) to supabase_auth_admin;
commit;
