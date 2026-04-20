# Prosody Supabase Snapshot - 2026-04-20

Captured before the tracked v3 migration set was added to the repo.

Observed via the live PostgREST OpenAPI and storage APIs:

- Auth settings endpoint reachable
- Google OAuth enabled
- PostgREST root reachable
- `conversation-sources` bucket exists

Observed table families in the public schema:

- `profiles`
- `conversations`
- `sources`
- `sessions`
- `turns`
- `latency_events`
- `degradation_events`
- `conversation_summaries`
- `flashcard_sets`

Observed drift from the v3 canonical repo design:

- `conversations` currently uses `archived boolean` instead of `status text`
- `sources` currently exposes `status` instead of `processing_status`
- `sessions` currently exposes `transport` instead of `transport_kind`
- `latency_events` currently uses `name` and `timestamp`
- `degradation_events` currently uses `reason` and `recovery`

This snapshot is documentation-only and exists to preserve pre-v3 cloud context before the repo migration set is applied.
