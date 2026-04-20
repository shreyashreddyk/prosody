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
- Storage bucket: `conversation-sources`
- RLS enabled on every user-owned product table
- Storage object paths restricted to:
  - `user/<auth.uid()>/conversations/<conversationId>/sources/<sourceId>/...`

## Notes

- The live cloud project already exposes the target table family and the `conversation-sources` bucket.
- The tracked migrations below are the canonical repo baseline even when the live project has pre-existing schema history.
