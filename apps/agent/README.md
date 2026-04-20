# Prosody Agent

This package hosts the FastAPI realtime agent for Prosody.

Current local v1 responsibilities:

- health and metadata endpoints
- local session creation and teardown
- SmallWebRTC offer/ICE handling
- Pipecat pipeline orchestration for Deepgram Flux, OpenAI, and ElevenLabs
- local JSON/JSONL persistence for sessions, transcripts, turns, and latency events
