-- Supabase preloads pg-safeupdate for API sessions, which rejects UPDATE/DELETE without a WHERE
-- clause ("UPDATE requires a WHERE clause"). commit_bank_world bumped every profile revision with a
-- bare UPDATE, so every banking mutation failed. Same behaviour, explicit WHERE.
create or replace function public.commit_bank_world(next_data jsonb, expected_version bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
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
