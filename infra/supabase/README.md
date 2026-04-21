# Supabase

Prosody v3 uses the shared cloud Supabase project for auth, database, and storage in both deployed and local development flows.

## Layout

- `migrations/`: tracked SQL migrations that define the canonical Prosody schema
- `snapshots/`: notes about pre-v3 cloud schema state captured before the tracked migration set

## Apply Strategy

- Treat the SQL in this directory as the source of truth.
- Apply migrations to the cloud project only.
- Do not spin up a local Supabase stack for this repo.

## Recommended Apply Flow

1. Confirm the repo migration files match the intended cloud rollout.
2. Link the CLI to the Prosody cloud project or use your preferred SQL apply path.
3. Apply the migrations in order.
4. Re-run schema verification against the live PostgREST OpenAPI and storage APIs.
5. Smoke test Google OAuth, conversation CRUD, source uploads, and authenticated agent calls.

## Required Runtime Resources

- Auth provider: Google OAuth enabled in Supabase Auth
- Storage bucket: `conversation-sources` (private)
- RLS enabled on every user-owned product table
- Storage object paths restricted to:
  - `user/<auth.uid()>/conversations/<conversationId>/sources/<sourceId>/...`
- `storage.objects` policies for the `conversation-sources` bucket match that path
  via `name like 'user/' || auth.uid()::text || '/conversations/%'`. Do not
  use `storage.foldername(name)[1]`: the first path segment is the literal
  string `user`, not the UID, so that form rejects every upload.

## Migration Order

Apply in timestamp order:

1. `20260420T000000_v3_product_persistence.sql` — canonical repo baseline (tables, RLS, bucket).
2. `20260420T010000_allow_session_lifecycle_statuses.sql` — widens `sessions.status` CHECK.
3. `20260420T020000_normalize_realtime_tables_canonical_columns.sql` — canonical columns + dual-write triggers for sessions / latency_events / degradation_events.
4. `20260421T000000_align_sources_canonical_columns.sql` — adds canonical
   `kind`, `storage_bucket`, `processing_status` columns to `public.sources`
   on cloud projects whose bootstrap predates the repo baseline, drops the
   legacy `status` column after backfill, and rewrites the four
   `storage_conversation_sources_*_own` storage policies to the canonical
   path form. Required so the web client's `uploadSource` works end-to-end.

## Source Uploads Model

Files are stored in Supabase Storage, not in Postgres. `public.sources` holds
only metadata:

- One row per uploaded file, keyed by `id` (uuid).
- `storage_bucket` + `storage_path` locate the blob.
- `processing_status` transitions `pending → ready` (or `failed`) and is
  owned by whichever process handles the upload. Today that is the web
  client; future agent-side ingestion can take it over without a schema
  change.

## Reading Sources From the Agent

The FastAPI agent reads source files server-side when generating summaries or
flashcards. See [apps/agent/app/storage/sources.py](../../apps/agent/app/storage/sources.py).

- Auth: the agent's `SupabaseSessionStore` authenticates with
  `SUPABASE_SERVICE_ROLE_KEY`, which **bypasses RLS**. Ownership is therefore
  enforced in code by filtering `public.sources` on both
  `conversation_id = :conv` and `owner_user_id = :user`. Callers must pass
  the authenticated user's id.
- Filter: only `processing_status = 'ready'` rows are considered. Pending /
  failed rows are skipped silently.
- Object fetch: `GET {SUPABASE_URL}/storage/v1/object/{storage_bucket}/{storage_path}`
  using the existing service-role-authenticated `httpx.Client`. Any non-2xx
  is logged and the source is marked `[omitted: download failed]` in the
  prompt — the rest of the generation call proceeds.
- Text extraction: `text/*` and `application/json|xml` are UTF-8 decoded;
  `application/pdf` is extracted with `pypdf` (pure Python). Unsupported
  MIME types are skipped with a note. Per-source and total character budgets
  keep prompts within the LLM context window.

## Notes

- The live cloud project already exposes the target table family and the `conversation-sources` bucket.
- The tracked migrations below are the canonical repo baseline even when the live project has pre-existing schema history.
