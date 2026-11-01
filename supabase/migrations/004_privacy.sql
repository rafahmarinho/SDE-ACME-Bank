-- Privacy enforcement in the database. Apply after 003_session_hardening.sql.
-- 1. Withdrawing the "statement-archive" consent stops statement uploads at the Storage policy,
--    not only in the browser.
-- 2. Supabase Auth is the system of record for the email address: a confirmed change is copied
--    into the bank's customer record at once, so the two stores never disagree.
-- 3. Provisioning is idempotent: a customer is never added twice to the bank record.
begin;

-- Helpers for policies and triggers live outside the schemas exposed by the Data API.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- True only while the signed-in customer consents to keeping copies of exported statements.
create function private.statement_archive_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select (customer->'privacy'->'consents'->>'statement-archive')::boolean
    from public.bank_world, jsonb_array_elements(data->'customers') customer
    where id = 1 and customer->>'id' = auth.uid()::text
  ), false);
$$;
revoke all on function private.statement_archive_allowed() from public, anon;
grant execute on function private.statement_archive_allowed() to authenticated;

drop policy private_statements_insert on storage.objects;
create policy private_statements_insert on storage.objects for insert to authenticated
with check (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text
  and (auth.jwt() ->> 'aal') = 'aal2' and private.statement_archive_allowed());

-- Confirmed email changes in Supabase Auth reach the bank record (and its audit trail) at once.
-- The world version is bumped so a concurrent API commit cannot overwrite the new address.
create function private.sync_customer_email() returns trigger
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  event_id uuid := gen_random_uuid();
begin
  update public.bank_world set
    data = jsonb_set(jsonb_set(jsonb_set(data,
      '{customers}', (
        select jsonb_agg(case when customer->>'id' = new.id::text
          then jsonb_set(customer, '{email}', to_jsonb(new.email)) else customer end order by position)
        from jsonb_array_elements(data->'customers') with ordinality as list(customer, position))),
      '{events}', jsonb_build_array(jsonb_build_object('id', event_id, 'date', data->>'clock',
        'actor', new.id::text, 'message', 'Email address updated from the verified sign-in record'))
        || coalesce(data->'events', '[]'::jsonb)),
      '{version}', to_jsonb((data->>'version')::bigint + 1)),
    updated_at = now()
  where id = 1 and exists (
    select 1 from jsonb_array_elements(data->'customers') customer
    where customer->>'id' = new.id::text and customer->>'email' is distinct from new.email);
  if found then
    insert into public.audit_events(id, actor, event_time, message)
    values (event_id, new.id::text, now(), 'Email address updated from the verified sign-in record');
    update public.profiles set revision = revision + 1 where id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_customer_email() from public, anon, authenticated;
create trigger on_auth_user_email_changed after update of email on auth.users
for each row when (old.email is distinct from new.email)
execute function private.sync_customer_email();

-- Same as 003, plus: a user already present in the bank record is not appended again.
create or replace function public.provision_customer() returns trigger
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  profile jsonb;
  customers integer;
begin
  select jsonb_array_length(data->'customers') into customers
  from public.bank_world where id = 1 for update;
  if customers >= 10000 then raise exception 'Customer capacity reached'; end if;
  insert into public.profiles(id) values(new.id) on conflict (id) do nothing;
  if exists (select 1 from public.bank_world, jsonb_array_elements(data->'customers') customer
             where id = 1 and customer->>'id' = new.id::text) then
    return new;
  end if;
  profile = jsonb_build_object('id',new.id::text,'name','New customer','email',new.email,'role','customer','onboarded',false,'notifications',false);
  update public.bank_world set data = jsonb_set(jsonb_set(data,'{customers}',(data->'customers') || jsonb_build_array(profile)),'{version}',to_jsonb((data->>'version')::bigint + 1)) where id = 1;
  return new;
end;
$$;
revoke all on function public.provision_customer() from public, anon, authenticated;
commit;
