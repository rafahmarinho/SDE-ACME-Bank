-- Audit trail protection. Apply after 006_api_role.sql.
-- 1. audit_events is append-only for everyone, the table owner included: UPDATE, DELETE and
--    TRUNCATE are refused by triggers.
-- 2. Every row is chained to the previous one with SHA-256 (hash of the previous hash and the row's
--    fields), so a changed, removed or reordered row is detected by public.audit_chain_broken_at().
-- 3. Read-only access for viewing and reports: the bank_auditor role can run audit_report() and
--    the chain check, and nothing else.
begin;

alter table public.audit_events
  add column seq bigint,
  add column previous_hash bytea,
  add column hash bytea;
create sequence public.audit_events_seq owned by public.audit_events.seq;

-- Canonical, unambiguous encoding of a row (a JSON array), chained to the previous digest.
create function private.audit_digest(previous bytea, id uuid, actor text, event_time timestamptz,
  recorded_at timestamptz, message text) returns bytea
language sql immutable set search_path = '' as $$
  select sha256(coalesce(previous, '\x'::bytea) || convert_to(jsonb_build_array(
    id, actor, (extract(epoch from event_time) * 1000000)::bigint,
    (extract(epoch from recorded_at) * 1000000)::bigint, message)::text, 'UTF8'));
$$;

-- Chain the rows already recorded, in the order they were recorded.
do $$
declare
  entry record;
  previous bytea;
begin
  for entry in select id from public.audit_events order by recorded_at, event_time, id loop
    update public.audit_events set
      seq = nextval('public.audit_events_seq'),
      previous_hash = previous,
      hash = private.audit_digest(previous, id, actor, event_time, recorded_at, message)
    where id = entry.id
    returning hash into previous;
  end loop;
end;
$$;
alter table public.audit_events
  alter column seq set not null,
  alter column hash set not null,
  add constraint audit_events_seq_key unique (seq);

-- New rows: one writer at a time takes the next position and links to the latest digest.
create function private.audit_chain() returns trigger
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(7266013);
  new.seq := nextval('public.audit_events_seq');
  new.recorded_at := coalesce(new.recorded_at, now());
  select hash into new.previous_hash from public.audit_events order by seq desc limit 1;
  new.hash := private.audit_digest(new.previous_hash, new.id, new.actor, new.event_time,
    new.recorded_at, new.message);
  return new;
end;
$$;
create trigger audit_events_chain before insert on public.audit_events
for each row execute function private.audit_chain();

create function private.audit_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_events is append-only';
end;
$$;
create trigger audit_events_no_change before update or delete on public.audit_events
for each row execute function private.audit_append_only();
create trigger audit_events_no_truncate before truncate on public.audit_events
for each statement execute function private.audit_append_only();
revoke all on function private.audit_digest(bytea, uuid, text, timestamptz, timestamptz, text),
  private.audit_chain(), private.audit_append_only() from public, anon, authenticated;
revoke trigger, references on public.audit_events from service_role;

-- Same as 003, except that events already in the audit trail are not offered again, so only new
-- events go through the chain. (CREATE OR REPLACE keeps the existing EXECUTE grants.)
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
    and not exists (select 1 from public.audit_events audit where audit.id = (event->>'id')::uuid)
  on conflict (id) do nothing;
  update public.profiles set revision = revision + 1 where true;
  return true;
end;
$$;

-- Position of the first row whose digest or link does not verify; null when the chain is intact.
create function public.audit_chain_broken_at() returns bigint
language sql stable security definer set search_path = '' as $$
  select min(seq) from (
    select seq, hash, previous_hash, lag(hash) over (order by seq) as expected_previous,
      private.audit_digest(previous_hash, id, actor, event_time, recorded_at, message) as computed
    from public.audit_events
  ) chain
  where hash is distinct from computed or previous_hash is distinct from expected_previous;
$$;

-- Latest audit rows for viewing and reports, with the result of the chain check.
create function public.audit_report(max_rows integer default 100)
returns table (seq bigint, id uuid, actor text, event_time timestamptz, recorded_at timestamptz,
  message text, chain_intact boolean)
language sql stable security definer set search_path = '' as $$
  select audit.seq, audit.id, audit.actor, audit.event_time, audit.recorded_at, audit.message,
    public.audit_chain_broken_at() is null
  from public.audit_events audit
  order by audit.seq desc
  limit least(greatest(coalesce(max_rows, 100), 1), 1000);
$$;
revoke all on function public.audit_chain_broken_at(), public.audit_report(integer)
  from public, anon, authenticated;

create role bank_auditor nologin noinherit;
grant usage on schema public to bank_auditor;
grant execute on function public.audit_chain_broken_at(), public.audit_report(integer)
  to bank_auditor, service_role;
commit;
