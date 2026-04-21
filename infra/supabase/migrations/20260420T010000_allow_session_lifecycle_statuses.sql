-- Align live `public.sessions.status` constraint with the app's intended
-- session lifecycle states. The v3 cloud bootstrap (2026-04-17) shipped with
-- `('scheduled','live','ended','failed')`, which rejects the `connecting`
-- status written by the agent on every new live session and caused
-- "Unable to create a live session" from the web UI.
--
-- This migration:
--  * widens the CHECK constraint to cover the full lifecycle used by the
--    agent and repo schema: idle → connecting → live → (reconnecting) →
--    ended/failed, and keeps `scheduled` for back-compat with existing data.
--  * sets the column default to `'idle'` so inserts that omit status behave
--    like the repo-intended schema in
--    `20260420T000000_v3_product_persistence.sql`.

alter table public.sessions
  drop constraint if exists sessions_status_check;

alter table public.sessions
  add constraint sessions_status_check
  check (
    status = any (
      array[
        'idle'::text,
        'connecting'::text,
        'live'::text,
        'reconnecting'::text,
        'ended'::text,
        'failed'::text,
        'scheduled'::text
      ]
    )
  );

alter table public.sessions
  alter column status set default 'idle';
