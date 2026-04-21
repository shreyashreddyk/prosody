-- Normalize the live Prosody public schema so sessions, latency_events,
-- and degradation_events carry the canonical column names used by the app
-- contracts, without dropping the legacy columns that existing write paths
-- still use. Rows are backfilled in-place; triggers keep canonical and
-- legacy columns in sync during the dual-write period.
--
-- Scope: schema normalization + backfill only. No product-behavior changes.
--
-- Applied 2026-04-20 via Supabase MCP `apply_migration` as
-- `normalize_realtime_tables_canonical_columns`.

-- ============================================================================
-- sessions: add canonical transport_kind alongside legacy transport
-- ============================================================================
alter table public.sessions
  add column if not exists transport_kind text;

update public.sessions
  set transport_kind = transport
  where transport_kind is null and transport is not null;

update public.sessions
  set transport_kind = 'smallwebrtc'
  where transport_kind is null;

alter table public.sessions alter column transport_kind set default 'smallwebrtc';
alter table public.sessions alter column transport_kind set not null;
alter table public.sessions alter column transport drop not null;

alter table public.sessions drop constraint if exists sessions_transport_kind_check;
alter table public.sessions
  add constraint sessions_transport_kind_check
  check (transport_kind = any (array['smallwebrtc'::text, 'daily'::text]));

create or replace function public.sessions_sync_transport()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.transport_kind is null and new.transport is not null then
      new.transport_kind := new.transport;
    end if;
    if new.transport is null and new.transport_kind is not null then
      new.transport := new.transport_kind;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.transport is distinct from old.transport
       and new.transport_kind is not distinct from old.transport_kind then
      new.transport_kind := new.transport;
    elsif new.transport_kind is distinct from old.transport_kind
       and new.transport is not distinct from old.transport then
      new.transport := new.transport_kind;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sessions_sync_transport on public.sessions;
create trigger sessions_sync_transport
before insert or update on public.sessions
for each row execute function public.sessions_sync_transport();

-- ============================================================================
-- latency_events: add canonical stage / started_at / completed_at / duration_ms
-- ============================================================================
alter table public.latency_events
  add column if not exists stage text,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists duration_ms numeric;

update public.latency_events
  set stage = coalesce(stage, name),
      started_at = coalesce(started_at, "timestamp");

alter table public.latency_events alter column stage set not null;
alter table public.latency_events alter column started_at set not null;
alter table public.latency_events alter column name drop not null;
alter table public.latency_events alter column "timestamp" drop not null;

create or replace function public.latency_events_sync_canonical()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.stage is null and new.name is not null then new.stage := new.name; end if;
    if new.name is null and new.stage is not null then new.name := new.stage; end if;
    if new.started_at is null and new."timestamp" is not null then new.started_at := new."timestamp"; end if;
    if new."timestamp" is null and new.started_at is not null then new."timestamp" := new.started_at; end if;
  elsif tg_op = 'UPDATE' then
    if new.name is distinct from old.name and new.stage is not distinct from old.stage then
      new.stage := new.name;
    elsif new.stage is distinct from old.stage and new.name is not distinct from old.name then
      new.name := new.stage;
    end if;
    if new."timestamp" is distinct from old."timestamp" and new.started_at is not distinct from old.started_at then
      new.started_at := new."timestamp";
    elsif new.started_at is distinct from old.started_at and new."timestamp" is not distinct from old."timestamp" then
      new."timestamp" := new.started_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists latency_events_sync_canonical on public.latency_events;
create trigger latency_events_sync_canonical
before insert or update on public.latency_events
for each row execute function public.latency_events_sync_canonical();

create index if not exists idx_latency_events_session_started_at
  on public.latency_events (session_id, started_at);

-- ============================================================================
-- degradation_events: add canonical category / code / details / created_at /
-- recovered_at alongside legacy reason / timestamp / recovery
-- ============================================================================
alter table public.degradation_events
  add column if not exists category text,
  add column if not exists code text,
  add column if not exists details jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz,
  add column if not exists recovered_at timestamptz;

update public.degradation_events
  set category = coalesce(category, reason),
      created_at = coalesce(created_at, "timestamp");

update public.degradation_events set created_at = timezone('utc', now()) where created_at is null;

alter table public.degradation_events alter column category set not null;
alter table public.degradation_events alter column created_at set default timezone('utc', now());
alter table public.degradation_events alter column created_at set not null;
alter table public.degradation_events alter column reason drop not null;
alter table public.degradation_events alter column "timestamp" drop not null;

alter table public.degradation_events drop constraint if exists degradation_events_severity_check;
alter table public.degradation_events
  add constraint degradation_events_severity_check
  check (severity = any (array['info'::text, 'warning'::text, 'error'::text, 'critical'::text]));

create or replace function public.degradation_events_sync_canonical()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.category is null and new.reason is not null then new.category := new.reason; end if;
    if new.reason is null and new.category is not null then new.reason := new.category; end if;
    if new.created_at is null and new."timestamp" is not null then new.created_at := new."timestamp"; end if;
    if new."timestamp" is null and new.created_at is not null then new."timestamp" := new.created_at; end if;
  elsif tg_op = 'UPDATE' then
    if new.reason is distinct from old.reason and new.category is not distinct from old.category then
      new.category := new.reason;
    elsif new.category is distinct from old.category and new.reason is not distinct from old.reason then
      new.reason := new.category;
    end if;
    if new."timestamp" is distinct from old."timestamp" and new.created_at is not distinct from old.created_at then
      new.created_at := new."timestamp";
    elsif new.created_at is distinct from old.created_at and new."timestamp" is not distinct from old."timestamp" then
      new."timestamp" := new.created_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists degradation_events_sync_canonical on public.degradation_events;
create trigger degradation_events_sync_canonical
before insert or update on public.degradation_events
for each row execute function public.degradation_events_sync_canonical();

create index if not exists idx_degradation_events_session_created_at
  on public.degradation_events (session_id, created_at);

-- ============================================================================
-- conversations: last_activity_at
-- ============================================================================
alter table public.conversations
  add column if not exists last_activity_at timestamptz;

update public.conversations
  set last_activity_at = coalesce(last_activity_at, updated_at, created_at);

alter table public.conversations alter column last_activity_at set default timezone('utc', now());
alter table public.conversations alter column last_activity_at set not null;

create index if not exists idx_conversations_owner_last_activity
  on public.conversations (owner_user_id, last_activity_at desc);

-- ============================================================================
-- profiles: email (nullable, backfilled from auth.users)
-- ============================================================================
alter table public.profiles
  add column if not exists email text;

update public.profiles p
  set email = u.email
  from auth.users u
  where u.id = p.id and p.email is null;
