from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import get_current_user
from app.models import (
    AuthenticatedUser,
    ConversationSummaryRecord,
    FlashcardRecord,
    FlashcardSetRecord,
    GenerateFlashcardsResponse,
    GenerateSummaryResponse,
)
from app.storage.sources import build_sources_context

router = APIRouter()


# ── System Prompts ──


SUMMARY_SYSTEM_PROMPT = """You are an expert Interview and Presentation Coach. Your goal is to analyze coaching session transcripts and produce highly structured, concise, and actionable feedback summaries. You prioritize high-value insights, clear improvement areas, and specific next steps over mere transcription.

Task:
Summarize the provided coaching transcript by extracting the core signal from the conversation. Your output must be structured, scannable, and directly useful for the client's growth.

Output Structure:
1. Executive Summary: A 2-3 sentence overview of the session's focus and the client's current progress.
2. Key Strengths: 3 bullet points highlighting what the client did well (e.g., communication clarity, problem-solving approach, confidence, pacing, structure of responses).
3. Areas for Development: 3 bullet points focusing on critical gaps or weaknesses, supported by brief evidence from the transcript.
4. Actionable Growth Plan: A numbered list of 3-5 specific, achievable tasks or practice techniques the client should implement before the next session.
5. Notable Moments: Include 1-2 brief observations from the session that illustrate a breakthrough or a core learning moment.

Tone & Style Guidelines:
- Concise: Use bullet points and short, direct sentences. No filler or fluff.
- Action-Oriented: Every piece of feedback should be tied to a concrete action.
- Constructive: Maintain a motivating, professional, and empathetic tone.
- Evidence-Based: When noting a weakness, briefly reference why it matters.
- Second Person: Address the client as "you" directly.

Constraints:
- Summarize by thematic insight, not chronologically.
- If the transcript is thin or has few turns, acknowledge this briefly and focus on what is available.
- Keep the total summary under 400 words.
- Write in plain text with markdown formatting (headers, bullets, numbered lists).
- Do not include raw timestamps or turn IDs.

Source grounding:
If the user message includes an `## Attached sources` section, treat those documents (resume, job description, study notes, etc.) as ground-truth context about the client and ground your feedback in them where relevant. If no attached sources are present, rely on the transcript alone."""


FLASHCARD_SYSTEM_PROMPT = """You are an expert educational assistant specializing in creating high-yield study materials from coaching and interview practice transcripts. Your goal is to convert session transcripts into effective, atomic flashcards designed for long-term retention using active recall.

Guidelines:
1. Atomicity: Each flashcard tests exactly one concept, insight, or coaching point. No compound questions.
2. Conciseness: Keep prompts and answers brief. Apply the Minimum Information Principle — include only enough information to make the question unambiguous.
3. Self-Containment: Every flashcard must be understandable in isolation without needing the original transcript.
4. Active Recall: Focus on "What," "Why," and "How" questions. Avoid simple yes/no or recognition-based questions.
5. Coaching Focus: Prioritize actionable coaching insights — communication techniques, response frameworks, behavioral strategies, pacing tips, and confidence builders.
6. Quality over Quantity: Generate 5-10 high-quality flashcards. If the transcript is short, generate fewer but better cards.

Output Format:
Return ONLY a JSON array of objects. Each object has exactly two string fields: "prompt" and "answer".
Do not include any text before or after the JSON array. Do not wrap in markdown code fences.
Example:
[
  {"prompt": "What is the STAR method for behavioral interview answers?", "answer": "Situation — describe the context. Task — explain your responsibility. Action — detail what you did. Result — share the outcome and impact."},
  {"prompt": "Why should you pause before answering a difficult question?", "answer": "Pausing gives you time to organize your thoughts, shows composure and confidence, and prevents filler words that undermine credibility."}
]

Constraints:
- Extract insights from the coaching dialogue, not surface-level facts.
- If the coach gave a specific technique or framework, create a flashcard for it.
- If the user demonstrated a strength, create a flashcard that reinforces it.
- If the user had a weakness, create a flashcard about the corrective approach.
- Do not reference specific names, timestamps, or session metadata.
- Do not include any explanatory text outside the JSON array.

Source grounding:
If the user message includes an `## Attached sources` section, use those documents (resume, job description, study notes, etc.) as additional context when choosing which concepts deserve flashcards, but never quote personal details like names or contact info."""


# ── Helpers ──


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _build_transcript_text(turns: list[dict]) -> str:
    """Build a readable transcript from turn records."""
    lines: list[str] = []
    for turn in turns:
        user_text = turn.get("user_text")
        assistant_text = turn.get("assistant_text")
        if user_text:
            lines.append(f"User: {user_text}")
        if assistant_text:
            lines.append(f"Coach: {assistant_text}")
    return "\n\n".join(lines)


async def _call_openai(api_key: str, model: str, system_prompt: str, user_message: str) -> str:
    """Call OpenAI chat completions synchronously (the SDK is sync by default)."""
    from openai import OpenAI

    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        temperature=0.4,
        max_tokens=2000,
    )
    return response.choices[0].message.content or ""


# ── Routes ──


@router.post(
    "/api/conversations/{conversation_id}/summary",
    response_model=GenerateSummaryResponse,
)
async def generate_summary(
    conversation_id: str,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
) -> GenerateSummaryResponse:
    store = request.app.state.store
    settings = request.app.state.settings

    if not settings.openai_api_key:
        raise HTTPException(status_code=503, detail="OpenAI API key not configured")

    # Auth check
    try:
        store.ensure_conversation_owner(conversation_id, user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # Load all sessions for this conversation
    session_rows = store._get(
        "sessions",
        params={
            "select": "id",
            "conversation_id": f"eq.{conversation_id}",
            "status": "eq.ended",
            "order": "created_at.asc",
        },
    )

    if not session_rows:
        raise HTTPException(status_code=400, detail="No completed sessions to summarize")

    # Load turns from all sessions
    all_turns: list[dict] = []
    for session_row in session_rows:
        turn_rows = store._get(
            "turns",
            params={
                "select": "*",
                "conversation_id": f"eq.{conversation_id}",
                "session_id": f"eq.{session_row['id']}",
                "order": "turn_index.asc",
            },
        )
        all_turns.extend(turn_rows)

    if not all_turns:
        raise HTTPException(status_code=400, detail="No transcript turns available")

    transcript = _build_transcript_text(all_turns)

    sources_block = build_sources_context(store, conversation_id, user.id)
    user_message_parts = [
        f"Here is the full coaching transcript across {len(session_rows)} session(s):\n\n{transcript}"
    ]
    if sources_block:
        user_message_parts.append(sources_block)
    user_message = "\n\n".join(user_message_parts)
    summary_text = await _call_openai(
        api_key=settings.openai_api_key,
        model=settings.llm_model,
        system_prompt=SUMMARY_SYSTEM_PROMPT,
        user_message=user_message,
    )

    # Persist to Supabase
    summary_id = str(uuid.uuid4())
    generated_at = _iso_now()

    store._post(
        "conversation_summaries",
        {
            "id": summary_id,
            "conversation_id": conversation_id,
            "owner_user_id": user.id,
            "summary_text": summary_text.strip(),
            "generated_at": generated_at,
        },
    )

    record = ConversationSummaryRecord(
        id=summary_id,
        conversationId=conversation_id,
        summaryText=summary_text.strip(),
        generatedAt=generated_at,
    )
    return GenerateSummaryResponse(summary=record)


@router.post(
    "/api/conversations/{conversation_id}/sessions/{session_id}/flashcards",
    response_model=GenerateFlashcardsResponse,
)
async def generate_flashcards(
    conversation_id: str,
    session_id: str,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
) -> GenerateFlashcardsResponse:
    store = request.app.state.store
    settings = request.app.state.settings

    if not settings.openai_api_key:
        raise HTTPException(status_code=503, detail="OpenAI API key not configured")

    # Auth check
    try:
        store.ensure_conversation_owner(conversation_id, user.id)
        store.ensure_session_owner(session_id, user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    # Load turns
    turn_rows = store._get(
        "turns",
        params={
            "select": "*",
            "conversation_id": f"eq.{conversation_id}",
            "session_id": f"eq.{session_id}",
            "order": "turn_index.asc",
        },
    )

    if not turn_rows:
        raise HTTPException(status_code=400, detail="No transcript turns available for this session")

    transcript = _build_transcript_text(turn_rows)

    sources_block = build_sources_context(store, conversation_id, user.id)
    user_message_parts = [f"Here is the coaching session transcript:\n\n{transcript}"]
    if sources_block:
        user_message_parts.append(sources_block)
    user_message = "\n\n".join(user_message_parts)
    raw_response = await _call_openai(
        api_key=settings.openai_api_key,
        model=settings.llm_model,
        system_prompt=FLASHCARD_SYSTEM_PROMPT,
        user_message=user_message,
    )

    # Parse JSON response
    try:
        # Strip any markdown code fences if present
        cleaned = raw_response.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1] if "\n" in cleaned else cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        parsed = json.loads(cleaned.strip())
    except (json.JSONDecodeError, IndexError):
        raise HTTPException(
            status_code=502,
            detail="Failed to parse flashcard response from language model",
        )

    if not isinstance(parsed, list):
        raise HTTPException(status_code=502, detail="Expected a JSON array of flashcards")

    cards: list[FlashcardRecord] = []
    for i, item in enumerate(parsed):
        if isinstance(item, dict) and "prompt" in item and "answer" in item:
            cards.append(
                FlashcardRecord(
                    id=str(uuid.uuid4()),
                    prompt=item["prompt"],
                    answer=item["answer"],
                    tags=item.get("tags", []),
                )
            )

    if not cards:
        raise HTTPException(status_code=502, detail="Language model returned no valid flashcards")

    # Persist to Supabase
    flashcard_set_id = str(uuid.uuid4())
    generated_at = _iso_now()

    store._post(
        "flashcard_sets",
        {
            "id": flashcard_set_id,
            "conversation_id": conversation_id,
            "session_id": session_id,
            "owner_user_id": user.id,
            "cards": json.dumps([c.model_dump() for c in cards]),
            "generated_at": generated_at,
        },
    )

    record = FlashcardSetRecord(
        id=flashcard_set_id,
        conversationId=conversation_id,
        sessionId=session_id,
        generatedAt=generated_at,
        cards=cards,
    )
    return GenerateFlashcardsResponse(flashcardSet=record)
