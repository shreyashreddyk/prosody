create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.handle_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    display_name,
    avatar_url,
    created_at,
    updated_at
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email),
    new.raw_user_meta_data ->> 'avatar_url',
    timezone('utc', now()),
    timezone('utc', now())
  )
  on conflict (id) do update
    set display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        updated_at = timezone('utc', now());

  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  last_session_id uuid,
  last_activity_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'document',
  filename text not null,
  mime_type text not null,
  storage_bucket text not null default 'conversation-sources',
  storage_path text not null,
  size_bytes bigint not null default 0,
  processing_status text not null default 'pending' check (processing_status in ('pending', 'processing', 'ready', 'failed')),
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  transport_kind text not null default 'smallwebrtc' check (transport_kind in ('smallwebrtc', 'daily')),
  status text not null default 'idle' check (status in ('idle', 'connecting', 'live', 'ended', 'failed')),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.turns (
  id text primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  turn_index integer not null,
  user_text text,
  assistant_text text,
  user_audio_capture_start_at timestamptz,
  first_asr_partial_at timestamptz,
  final_asr_at timestamptz,
  llm_request_start_at timestamptz,
  llm_first_token_at timestamptz,
  tts_request_start_at timestamptz,
  tts_first_byte_at timestamptz,
  playback_start_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.latency_events (
  id text primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  turn_id text,
  stage text not null,
  sequence integer not null,
  source text not null default 'agent',
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null,
  completed_at timestamptz,
  duration_ms numeric,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.degradation_events (
  id text primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  turn_id text,
  category text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  provider text,
  code text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  recovered_at timestamptz
);

create table if not exists public.conversation_summaries (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  source_session_id uuid references public.sessions(id) on delete set null,
  summary_text text not null,
  generated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.flashcard_sets (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  cards jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists conversations_owner_user_id_idx on public.conversations(owner_user_id);
create index if not exists conversations_created_desc_idx on public.conversations(owner_user_id, created_at desc);
create index if not exists conversations_last_activity_idx on public.conversations(owner_user_id, last_activity_at desc);
create index if not exists sources_owner_user_id_idx on public.sources(owner_user_id);
create index if not exists sources_conversation_id_idx on public.sources(conversation_id);
create index if not exists sessions_owner_user_id_idx on public.sessions(owner_user_id);
create index if not exists sessions_conversation_id_idx on public.sessions(conversation_id);
create index if not exists sessions_created_desc_idx on public.sessions(conversation_id, created_at desc);
create index if not exists turns_owner_user_id_idx on public.turns(owner_user_id);
create index if not exists turns_conversation_id_idx on public.turns(conversation_id);
create index if not exists turns_session_id_idx on public.turns(session_id);
create index if not exists turns_created_desc_idx on public.turns(conversation_id, created_at desc);
create index if not exists latency_events_owner_user_id_idx on public.latency_events(owner_user_id);
create index if not exists latency_events_conversation_id_idx on public.latency_events(conversation_id);
create index if not exists latency_events_session_id_idx on public.latency_events(session_id);
create index if not exists degradation_events_owner_user_id_idx on public.degradation_events(owner_user_id);
create index if not exists degradation_events_conversation_id_idx on public.degradation_events(conversation_id);
create index if not exists degradation_events_session_id_idx on public.degradation_events(session_id);
create index if not exists conversation_summaries_owner_user_id_idx on public.conversation_summaries(owner_user_id);
create index if not exists conversation_summaries_conversation_id_idx on public.conversation_summaries(conversation_id);
create index if not exists flashcard_sets_owner_user_id_idx on public.flashcard_sets(owner_user_id);
create index if not exists flashcard_sets_conversation_id_idx on public.flashcard_sets(conversation_id);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists conversations_set_updated_at on public.conversations;
create trigger conversations_set_updated_at
before update on public.conversations
for each row execute function public.set_updated_at();

drop trigger if exists sources_set_updated_at on public.sources;
create trigger sources_set_updated_at
before update on public.sources
for each row execute function public.set_updated_at();

drop trigger if exists sessions_set_updated_at on public.sessions;
create trigger sessions_set_updated_at
before update on public.sessions
for each row execute function public.set_updated_at();

drop trigger if exists turns_set_updated_at on public.turns;
create trigger turns_set_updated_at
before update on public.turns
for each row execute function public.set_updated_at();

drop trigger if exists conversation_summaries_set_updated_at on public.conversation_summaries;
create trigger conversation_summaries_set_updated_at
before update on public.conversation_summaries
for each row execute function public.set_updated_at();

drop trigger if exists flashcard_sets_set_updated_at on public.flashcard_sets;
create trigger flashcard_sets_set_updated_at
before update on public.flashcard_sets
for each row execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_auth_user_profile();

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.sources enable row level security;
alter table public.sessions enable row level security;
alter table public.turns enable row level security;
alter table public.latency_events enable row level security;
alter table public.degradation_events enable row level security;
alter table public.conversation_summaries enable row level security;
alter table public.flashcard_sets enable row level security;

drop policy if exists "profiles_owner_access" on public.profiles;
create policy "profiles_owner_access" on public.profiles
for all
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "conversations_owner_access" on public.conversations;
create policy "conversations_owner_access" on public.conversations
for all
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "sources_owner_access" on public.sources;
create policy "sources_owner_access" on public.sources
for all
using (
  owner_user_id = auth.uid()
  and exists (
    select 1
    from public.conversations
    where conversations.id = sources.conversation_id
      and conversations.owner_user_id = auth.uid()
  )
)
with check (
  owner_user_id = auth.uid()
  and exists (
    select 1
    from public.conversations
    where conversations.id = sources.conversation_id
      and conversations.owner_user_id = auth.uid()
  )
);

drop policy if exists "sessions_owner_access" on public.sessions;
create policy "sessions_owner_access" on public.sessions
for all
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "turns_owner_access" on public.turns;
create policy "turns_owner_access" on public.turns
for all
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "latency_events_owner_access" on public.latency_events;
create policy "latency_events_owner_access" on public.latency_events
for all
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "degradation_events_owner_access" on public.degradation_events;
create policy "degradation_events_owner_access" on public.degradation_events
for all
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "conversation_summaries_owner_access" on public.conversation_summaries;
create policy "conversation_summaries_owner_access" on public.conversation_summaries
for all
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "flashcard_sets_owner_access" on public.flashcard_sets;
create policy "flashcard_sets_owner_access" on public.flashcard_sets
for all
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

insert into storage.buckets (id, name, public)
values ('conversation-sources', 'conversation-sources', false)
on conflict (id) do nothing;

drop policy if exists "conversation_sources_object_access" on storage.objects;
create policy "conversation_sources_object_access" on storage.objects
for all
using (
  bucket_id = 'conversation-sources'
  and auth.uid() is not null
  and name like 'user/' || auth.uid()::text || '/conversations/%'
)
with check (
  bucket_id = 'conversation-sources'
  and auth.uid() is not null
  and name like 'user/' || auth.uid()::text || '/conversations/%'
);
