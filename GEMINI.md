# GEMINI.md

## Purpose
You are primarily responsible for the frontend product experience for Prosody.

This is a production-style real-time multimodal web app with a persistent workspace model:
- conversation workspace
- multiple live sessions inside a conversation
- transcript history
- source uploads
- summaries
- flashcards
- metrics and latency panels

## Local `docs/` (not in Git)

The **`docs/` directory is gitignored** and is **not pushed to GitHub**. Any design notes, API prose, or progress files live **only on disk** for that clone. See `docs/README.md` and [AGENTS.md](AGENTS.md).

- **Mandatory policy:** For every meaningful decision or update that yields learning (UX/system behavior, architecture, framework/tooling, debugging root cause, major implementation change, or reversal), you MUST update relevant local `docs/` files in the same session.
- **Required decision metadata:** Document what changed, why, alternatives considered, tradeoffs, validation/evidence, and open questions.
- **Upsert / overwrite:** Update files under `docs/` as you work; when UX or product decisions change, replace outdated content rather than expecting Git history on the remote. These notes are the learning trail and source of truth for how the product is being built and shipped.

## Primary ownership
You may primarily modify:
- apps/web/**
- packages/ui/**
- **Local** `docs/01_system_design.md` (visual / UX architecture sections, if you maintain that file)
- **Local** `docs/06_api_contracts.md` (browser-facing API notes, if you maintain that file)
- **Local** `docs/progress/YYYY-MM-DD.md`

Do not change backend APIs casually.
If the UI requires API changes:
1. inspect packages/contracts
2. update contracts in a coordinated way
3. upsert the local `docs/06_api_contracts.md` if you keep API documentation there
4. document why the contract changed (e.g. in local `docs/03_decision_log.md`)

## Design direction
The app should feel:
- dark-mode first
- high-contrast
- futuristic but restrained
- serious, elegant, and productivity-oriented
- more like Linear / NotebookLM / Granola than a toy chatbot
- visually polished but not flashy
- fast and legible under long sessions

Use:
- thin borders
- subtle glows
- disciplined spacing
- clear state transitions
- stable layout with minimal jank
- excellent loading, empty, error, reconnect, and degraded states

Avoid:
- over-animated gimmicks
- excessive glassmorphism
- giant gradients that hurt readability
- cramped panels
- ambiguous icons
- invisible system status

## Product UX rules
Signed-out users should see:
- landing page
- product explanation
- demo CTA
- sign-in CTA

Signed-in first-time users should see:
- onboarding to create first conversation workspace
- source upload suggestions
- clear prompt to start first live session

Signed-in returning users should:
- land in last-opened conversation if available
- see a welcome-back state
- be able to continue the same conversation context

## Main app shell
The authenticated shell should use 3 panes.

Left pane:
- conversation list
- session list
- source upload and source list

Center pane:
- transcript history across sessions
- live session controls dock at bottom

Right pane:
- conversation summary
- metrics panel
- flashcards generation and browsing

## Realtime UX rules
The interface must clearly show:
- listening
- thinking
- speaking
- reconnecting
- degraded mode
- idle
- source processing

Realtime controls must be obvious and keyboard-friendly.

## Metrics UX rules
Expose metrics in a way that is understandable to both:
- technical reviewers
- end users who just want to know if the system is responsive

Show:
- last-turn latency breakdown
- rolling summary metrics
- degraded/fallback events
- optional advanced details tucked behind disclosure controls

## Engineering rules
- Use TypeScript everywhere practical.
- Keep components modular and composable.
- Prefer feature folders over giant shared dumping grounds.
- Use shared contracts from packages/contracts.
- Keep API calls typed.
- Add Storybook-style examples or component demos if practical.
- Add tests for non-trivial UI state and routing behavior.

## Documentation (local only)
When making meaningful frontend changes, upsert or overwrite under **`docs/`** as appropriate, for example:
- docs/01_system_design.md
- docs/02_learning_guide.md
- docs/03_decision_log.md
- docs/06_api_contracts.md if needed
- docs/progress/YYYY-MM-DD.md

This documentation update is mandatory for each meaningful, learning-bearing decision or update.

Nothing under `docs/` is committed or pushed; [AGENTS.md](AGENTS.md) defines the workflow.

## Output expectations
Before coding:
- inspect existing files
- summarize the UI plan
- name exact files to change

After coding:
- summarize what changed
- explain why
- list validations run
- note remaining UX or contract risks
