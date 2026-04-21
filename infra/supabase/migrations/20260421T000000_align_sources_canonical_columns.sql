-- Align the live `public.sources` table and the `storage.objects` RLS policies
-- for the `conversation-sources` bucket with the canonical Prosody contract
-- declared in `20260420T000000_v3_product_persistence.sql`.
--
-- Why this migration exists:
--  * The cloud project bootstrapped `public.sources` without the canonical
--    columns `kind`, `storage_bucket`, and `processing_status` — it only has
--    the legacy `status` column. This made the web client's `uploadSource`
--    insert path fail with "Could not find the 'processing_status' column"
--    (and the previous fallback insert chain was only a band-aid).
--  * The cloud storage RLS policies for `conversation-sources` check
--    `(storage.foldername(name))[1] = auth.uid()::text`, but the web client
--    writes to `user/<uid>/conversations/<convId>/sources/<sourceId>/<file>`,
--    so `foldername[1] = 'user'` and every upload was rejected by RLS.
--
-- This migration:
--  1. Adds the canonical columns on `public.sources` with safe defaults.
--  2. Backfills `processing_status` from legacy `status`, drops `status` and
--     its CHECK constraint, and installs the canonical
--     `processing_status` CHECK.
--  3. Replaces the 4 legacy storage policies with canonical ones that match
--     the repo path convention `user/<auth.uid()>/conversations/%`.
--
-- Safe to re-apply (idempotent guards everywhere).

-- ============================================================================
-- public.sources: canonical columns + constraint
-- ============================================================================
alter table public.sources
  add column if not exists kind text not null default 'document';

alter table public.sources
  add column if not exists storage_bucket text not null default 'conversation-sources';

alter table public.sources
  add column if not exists processing_status text;

update public.sources
   set processing_status = case
       when processing_status is not null then processing_status
       when status = 'uploaded' then 'pending'
       when status = 'processing' then 'processing'
       when status = 'ready' then 'ready'
       when status = 'failed' then 'failed'
       else 'pending'
   end
 where processing_status is null;

alter table public.sources alter column processing_status set default 'pending';
alter table public.sources alter column processing_status set not null;

alter table public.sources drop constraint if exists sources_status_check;
alter table public.sources drop constraint if exists sources_processing_status_check;
alter table public.sources
  add constraint sources_processing_status_check
  check (processing_status = any (array['pending'::text, 'processing'::text, 'ready'::text, 'failed'::text]));

-- Drop the legacy `status` column last so the backfill above can read it.
alter table public.sources drop column if exists status;

-- Re-assert updated_at trigger (the v3 repo baseline installs it; we make
-- sure it exists on the live table).
drop trigger if exists sources_set_updated_at on public.sources;
create trigger sources_set_updated_at
before update on public.sources
for each row execute function public.set_updated_at();

-- ============================================================================
-- storage.objects: canonical per-command policies for `conversation-sources`
-- ============================================================================
-- The repo path convention is:
--   user/<auth.uid()>/conversations/<conversationId>/sources/<sourceId>/<file>
-- Matching with `like` on the full `name` is clearer than `foldername[1]`
-- because the first segment is the literal string `user`, not the UID.

drop policy if exists "storage_conversation_sources_select_own" on storage.objects;
drop policy if exists "storage_conversation_sources_insert_own" on storage.objects;
drop policy if exists "storage_conversation_sources_update_own" on storage.objects;
drop policy if exists "storage_conversation_sources_delete_own" on storage.objects;
drop policy if exists "conversation_sources_object_access" on storage.objects;

create policy "storage_conversation_sources_select_own" on storage.objects
for select
using (
  bucket_id = 'conversation-sources'
  and auth.uid() is not null
  and name like 'user/' || auth.uid()::text || '/conversations/%'
);

create policy "storage_conversation_sources_insert_own" on storage.objects
for insert
with check (
  bucket_id = 'conversation-sources'
  and auth.uid() is not null
  and name like 'user/' || auth.uid()::text || '/conversations/%'
);

create policy "storage_conversation_sources_update_own" on storage.objects
for update
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

create policy "storage_conversation_sources_delete_own" on storage.objects
for delete
using (
  bucket_id = 'conversation-sources'
  and auth.uid() is not null
  and name like 'user/' || auth.uid()::text || '/conversations/%'
);
