-- Session, MFA and locking hardening. Apply after 002_commit_where_clause.sql and before deploying
-- the matching application code (the API refuses requests while session_activity is missing).
begin;

-- Last API activity per Supabase session. The API locks a session idle for more than 15 minutes
-- and never refreshes a locked row, so only a new sign-in (new session_id) restores access.
create table public.session_activity (
  session_id uuid primary key,
  actor uuid not null references auth.users(id) on delete cascade,
  last_seen timestamptz not null
);
alter table public.session_activity enable row level security;
revoke all on public.session_activity from anon, authenticated;

-- Direct Storage and profile access require the same TOTP assurance (aal2) as the API, so a
-- password-only session cannot list, download or upload statements.
drop policy private_statements_read on storage.objects;
drop policy private_statements_insert on storage.objects;
create policy private_statements_read on storage.objects for select to authenticated
using (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text
  and (auth.jwt() ->> 'aal') = 'aal2');
create policy private_statements_insert on storage.objects for insert to authenticated
with check (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text
  and (auth.jwt() ->> 'aal') = 'aal2');
drop policy own_profile on public.profiles;
create policy own_profile on public.profiles for select to authenticated
using (id = auth.uid() and (auth.jwt() ->> 'aal') = 'aal2');

-- Audit rows are written only by commit_bank_world (security definer), never directly with the
-- service key, so the key cannot forge audit history.
revoke insert on public.audit_events from service_role;

-- Lock order for every writer: the bank_world row first, then profiles. Waits are bounded by
-- lock_timeout so a stuck lock fails fast instead of piling up requests.
create or replace function public.commit_bank_world(next_data jsonb, expected_version bigint) returns boolean
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
begin
  if (next_data->>'version')::bigint <> expected_version + 1 then raise exception 'Invalid revision'; end if;
  update public.bank_world set data = next_data, updated_at = now()
  where id = 1 and (data->>'version')::bigint = expected_version;
  if not found then return false; end if;
  insert into public.audit_events(id, actor, event_time, message)
  select (event->>'id')::uuid, event->>'actor', (event->>'date')::timestamptz, event->>'message'
  from jsonb_array_elements(next_data->'events') event
  where event->>'id' <> 'seed-event'
  on conflict (id) do nothing;
  update public.profiles set revision = revision + 1 where true;
  return true;
end;
$$;
revoke all on function public.commit_bank_world(jsonb,bigint) from public, anon, authenticated;
grant execute on function public.commit_bank_world(jsonb,bigint) to service_role;

-- provision_customer used to insert the profile before updating bank_world (the reverse of
-- commit_bank_world), which could deadlock. It now locks bank_world first and refuses new
-- customers once the world holds 10,000, rolling back the sign-up instead of growing unbounded.
create or replace function public.provision_customer() returns trigger
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  profile jsonb;
  customers integer;
begin
  select jsonb_array_length(data->'customers') into customers
  from public.bank_world where id = 1 for update;
  if customers >= 10000 then raise exception 'Customer capacity reached'; end if;
  insert into public.profiles(id) values(new.id);
  profile = jsonb_build_object('id',new.id::text,'name','New customer','email',new.email,'role','customer','onboarded',false,'notifications',true);
  update public.bank_world set data = jsonb_set(jsonb_set(data,'{customers}',(data->'customers') || jsonb_build_array(profile)),'{version}',to_jsonb((data->>'version')::bigint + 1)) where id = 1;
  return new;
end;
$$;
revoke all on function public.provision_customer() from public, anon, authenticated;

alter function public.consume_request(uuid) set lock_timeout = '5s';
commit;
