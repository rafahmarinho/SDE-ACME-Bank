begin;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer','support','administrator')),
  revision bigint not null default 0
);
alter table public.profiles enable row level security;
create policy own_profile on public.profiles for select to authenticated using (id = auth.uid());
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

create table public.bank_world (
  id integer primary key check (id = 1),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.bank_world enable row level security;
revoke all on public.bank_world from anon, authenticated;

create table public.request_limits (
  actor uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  hits integer not null
);
alter table public.request_limits enable row level security;
revoke all on public.request_limits from anon, authenticated;

create table public.audit_events (
  id uuid primary key,
  actor text not null,
  event_time timestamptz not null,
  recorded_at timestamptz not null default now(),
  message text not null
);
alter table public.audit_events enable row level security;
revoke all on public.audit_events from anon, authenticated;
revoke update, delete, truncate on public.audit_events from service_role;

create function public.consume_request(actor_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare count_hits integer;
begin
  insert into public.request_limits as limits values (actor_id, now(), 1)
  on conflict (actor) do update set
    hits = case when limits.window_start < now() - interval '1 minute' then 1 else limits.hits + 1 end,
    window_start = case when limits.window_start < now() - interval '1 minute' then now() else limits.window_start end
  returning hits into count_hits;
  return count_hits <= 30;
end;
$$;
revoke all on function public.consume_request(uuid) from public, anon, authenticated;
grant execute on function public.consume_request(uuid) to service_role;

create function public.commit_bank_world(next_data jsonb, expected_version bigint) returns boolean
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
  update public.profiles set revision = revision + 1;
  return true;
end;
$$;
revoke all on function public.commit_bank_world(jsonb,bigint) from public, anon, authenticated;
grant execute on function public.commit_bank_world(jsonb,bigint) to service_role;

create function public.provision_customer() returns trigger
language plpgsql security definer set search_path = '' as $$
declare profile jsonb;
begin
  insert into public.profiles(id) values(new.id);
  profile = jsonb_build_object('id',new.id::text,'name','New customer','email',new.email,'role','customer','onboarded',false,'notifications',true);
  update public.bank_world set data = jsonb_set(jsonb_set(data,'{customers}',(data->'customers') || jsonb_build_array(profile)),'{version}',to_jsonb((data->>'version')::bigint + 1)) where id = 1;
  return new;
end;
$$;
revoke all on function public.provision_customer() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.provision_customer();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('statements','statements',false,5242880,array['application/pdf','text/csv']);
create policy private_statements_read on storage.objects for select to authenticated
using (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text);
create policy private_statements_insert on storage.objects for insert to authenticated
with check (bucket_id = 'statements' and (storage.foldername(name))[1] = auth.uid()::text);
alter publication supabase_realtime add table public.profiles;
commit;