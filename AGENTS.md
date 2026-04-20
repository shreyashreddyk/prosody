# AGENTS.md

## Repository purpose
This repository is a production-grade AI engineering portfolio project called Prosody.

The goal is both:
1. ship a real, deployable product-quality multimodal application
2. learn the system deeply through explicit, decision-oriented notes you maintain **locally**

Prosody is a real-time interview and presentation coach with:
- live voice interaction
- optional camera-based coaching cues
- persistent conversations across sessions
- source uploads per conversation
- transcript history
- summaries and flashcards
- latency instrumentation
- graceful degradation
- replay/debug mode

## Local `docs/` workspace (not in Git)

The directory **`docs/` is gitignored** and is **not pushed to GitHub**. It is a **local-only** place for charter, system design, API write-ups, decision logs, progress notes, and similar material.

- **Upsert:** Create or update files under `docs/` as needed.
- **Overwrite:** When a decision is reversed or superseded, **replace** the old content (or delete stale files). Do not rely on Git history for `docs/` on the remote—there is none.
- **Entry point:** See `docs/README.md` when that folder exists (agents may create it on first use).

## First files to read
When starting work, inspect in this order if they exist:
1. README.md
2. AGENTS.md (this file)
3. `docs/README.md` (local docs policy and layout hints, if present)
4. Any local files you or a prior run created under `docs/`, e.g. `docs/01_system_design.md`, `docs/06_api_contracts.md`, `docs/progress/YYYY-MM-DD.md`

## Working style
- Act like a careful senior engineer and technical teacher.
- Prefer small, testable, reviewable changes.
- Before editing, inspect the relevant repo structure and summarize the plan.
- If the task is non-trivial, propose a short stepwise plan before implementation.
- Do not make unrelated changes.
- Keep business logic visible and testable.
- Prefer explicit modules and typed contracts over hidden framework magic.

## Architecture constraints
- Frontend: React + Vite + TypeScript
- Backend: Python + FastAPI + Pipecat
- Local real-time transport: SmallWebRTCTransport
- Deployed real-time transport: DailyTransport
- ASR: Deepgram Flux
- TTS: ElevenLabs low-latency streaming model
- Auth: Supabase Auth with Google OAuth
- Database: Supabase Postgres
- File storage: Supabase Storage
- Deployment target: Cloud Run
- Video analytics are optional and low-risk only
- Do not frame camera features as diagnosis, emotion detection, or therapy

## Product model
Use these terms consistently:
- Conversation = persistent workspace/notebook across time
- Session = one live real-time call inside a conversation
- Turn = one user utterance and one assistant response
- Source = uploaded file or context asset attached to a conversation

A conversation can be resumed later. The system should support "welcome back" continuation.

## Frontend product requirements
The main authenticated app should use a three-pane layout:
- Left pane: conversations, sessions, and sources
- Center pane: transcript history and live voice controls
- Right pane: summary, flashcards, and metrics

Design goals:
- dark-mode first
- high contrast
- futuristic but restrained
- polished product UI, not hackathon UI
- fast perceived performance
- visible real-time state transitions
- clear degraded/fallback status when applicable

## Folder ownership and coordination
Treat this as a monorepo with clear boundaries:
- apps/web: frontend application
- apps/agent: realtime backend/orchestrator
- packages/contracts: shared API and event schemas (tracked; shipped with the repo)
- packages/ui: shared UI components
- infra: deployment and environment setup
- docs: **local-only** learning trail and decision record (gitignored; see above)

Any change to shared contracts must update:
- `packages/contracts` (required, in Git)
- the local **`docs/06_api_contracts.md`** (or equivalent) if you maintain API prose alongside code, so humans reading the tree on disk stay aligned

## Local documentation (when you maintain `docs/`)
- **Mandatory policy:** For every meaningful decision or update that creates learning (architecture, system behavior, framework/tooling choice, debugging root cause, major implementation change, or reversal), you MUST update the relevant local `docs/` files in the same work session. Do not defer this to a later pass.
- **Required decision metadata:** Each meaningful decision entry MUST capture: what was chosen, why, alternatives considered, tradeoffs, validation method/evidence, and open questions.
- **Upsert / overwrite:** Update files under `docs/` as you work; when UX or product decisions change, replace outdated content rather than expecting Git history on the remote. These notes are the learning trail and source of truth for how the system is being built and shipped. These paths are **conventions** for the gitignored `docs/` tree—create or refresh them when relevant:
- docs/00_project_charter.md
- docs/01_system_design.md
- docs/02_learning_guide.md
- docs/03_decision_log.md
- docs/04_eval_plan.md
- docs/05_failure_cases.md
- docs/06_api_contracts.md
- docs/07_references.md
- docs/progress/YYYY-MM-DD.md

## Decision logging
For any meaningful decision, document:
- what was chosen
- why it was chosen
- alternatives considered
- tradeoffs
- validation method
- open questions

This is required for each meaningful decision/update that yields learning, not optional.

## Implementation workflow
For non-trivial tasks:
1. inspect relevant files
2. propose a brief plan
3. implement in small steps
4. run validation
5. upsert or overwrite local `docs/` files as needed (gitignored; not pushed)
6. summarize changes, risks, and next steps

## Validation
- Always run the smallest relevant validation first.
- If tests or linters exist, run them after non-trivial changes.
- If no tests exist, suggest the smallest useful test to add.
- If a command cannot be run, say so explicitly and explain why.
- Never claim quality or latency improvements without evidence.

## Testing and eval expectations
Add or update tests for non-trivial behavior.

Prioritize:
- latency budget correctness
- session lifecycle correctness
- reconnect and timeout handling
- contract compatibility
- source attachment behavior
- auth and data isolation
- replay determinism
- degraded-mode fallbacks

If an eval exists, run the smallest relevant subset after changes.
Prefer before/after comparisons.

## Realtime system rules
This project must demonstrate:
- end-to-end latency decomposition
- explicit timeout handling
- graceful degradation
- replayability
- observability
- production-oriented transport design
- measurable quality and performance

For each turn, preserve or expose timing where possible:
- audio capture start
- first ASR partial
- end-of-turn/final ASR
- LLM request start
- LLM first token
- TTS request start
- TTS first byte
- playback start
- completion/end state

## Safety and reliability
- Do not delete files or overwrite large sections unless necessary.
- Ask before adding heavyweight dependencies or changing core architecture.
- Preserve metadata, traces, evaluation artifacts, and citations when present.
- Avoid claims that exceed the product scope.
- Keep camera features opt-in and non-diagnostic.
- Never let realtime flows block indefinitely; use explicit timeout paths.

## Communication
- Be concise but specific.
- Explain reasoning as decision rationale, not hidden chain-of-thought.
- After edits, summarize exactly:
  - what changed
  - why it changed
  - how it was validated
  - remaining risks
  - recommended next step