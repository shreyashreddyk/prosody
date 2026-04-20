prosody/
├── AGENTS.md
├── GEMINI.md
├── README.md
├── .env.example
├── .gitignore
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── docs/
│   ├── 00_project_charter.md
│   ├── 01_system_design.md
│   ├── 02_learning_guide.md
│   ├── 03_decision_log.md
│   ├── 04_eval_plan.md
│   ├── 05_failure_cases.md
│   ├── 06_api_contracts.md
│   ├── 07_references.md
│   └── progress/
│       └── YYYY-MM-DD.md
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   ├── pages/
│   │   │   ├── features/
│   │   │   │   ├── auth/
│   │   │   │   ├── conversations/
│   │   │   │   ├── sessions/
│   │   │   │   ├── sources/
│   │   │   │   ├── flashcards/
│   │   │   │   ├── metrics/
│   │   │   │   └── realtime/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── stores/
│   │   │   ├── lib/
│   │   │   └── styles/
│   │   ├── public/
│   │   └── tests/
│   └── agent/
│       ├── src/
│       │   ├── api/
│       │   ├── orchestrator/
│       │   ├── providers/
│       │   │   ├── asr/
│       │   │   ├── llm/
│       │   │   └── tts/
│       │   ├── transports/
│       │   ├── sessions/
│       │   ├── metrics/
│       │   ├── replay/
│       │   ├── storage/
│       │   ├── prompts/
│       │   ├── policies/
│       │   └── tests/
│       └── pyproject.toml
├── packages/
│   ├── contracts/
│   │   ├── src/
│   │   │   ├── conversation.ts
│   │   │   ├── session.ts
│   │   │   ├── metrics.ts
│   │   │   ├── flashcards.ts
│   │   │   └── source.ts
│   ├── ui/
│   │   ├── src/
│   │   │   ├── shell/
│   │   │   ├── panels/
│   │   │   ├── transcript/
│   │   │   ├── metrics/
│   │   │   └── controls/
│   └── config/
│       ├── eslint/
│       ├── typescript/
│       └── tailwind/
├── infra/
│   ├── cloudrun/
│   ├── daily/
│   ├── supabase/
│   └── scripts/
└── evals/
    ├── latency/
    ├── replay/
    ├── resilience/
    └── quality/