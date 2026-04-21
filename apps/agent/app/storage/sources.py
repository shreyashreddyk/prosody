"""Helpers for reading user-uploaded source files from Supabase Storage and
turning them into text we can stitch into LLM prompts.

Why this module exists:
  The summary and flashcards endpoints previously only saw the coaching
  transcript. Users attach resumes, job descriptions, and notes as Sources
  via the web client. These land in the private `conversation-sources`
  Storage bucket with a metadata row in `public.sources`. To let the LLM
  ground its feedback in that context, the agent needs to fetch the raw
  bytes and extract text before prompting.

Security model:
  `SupabaseSessionStore` uses the service-role key, which bypasses RLS.
  Callers MUST pass the authenticated user's id; we filter `owner_user_id`
  server-side so we never leak another user's sources. We only return rows
  with `processing_status='ready'`.

Failure mode:
  Fail open. If a specific source fails to download or parse, we log and
  skip it; other sources and the overall LLM call still succeed. If there
  are zero ready sources, the helpers return an empty string and callers
  just use the plain transcript prompt (same behaviour as before this
  feature existed).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from io import BytesIO
from typing import Any

import httpx

logger = logging.getLogger(__name__)

DEFAULT_PER_SOURCE_CHARS = 8_000
DEFAULT_TOTAL_CHARS = 24_000
TRUNCATION_MARKER = "\n\n… [truncated]"


@dataclass(slots=True)
class SourceRecord:
    id: str
    conversation_id: str
    filename: str
    mime_type: str
    storage_bucket: str
    storage_path: str
    size_bytes: int
    processing_status: str


def _row_to_record(row: dict[str, Any]) -> SourceRecord:
    return SourceRecord(
        id=str(row["id"]),
        conversation_id=str(row["conversation_id"]),
        filename=str(row.get("filename") or ""),
        mime_type=str(row.get("mime_type") or "application/octet-stream"),
        storage_bucket=str(row.get("storage_bucket") or "conversation-sources"),
        storage_path=str(row.get("storage_path") or ""),
        size_bytes=int(row.get("size_bytes") or 0),
        processing_status=str(row.get("processing_status") or "pending"),
    )


def list_conversation_sources(store: Any, conversation_id: str, user_id: str) -> list[SourceRecord]:
    """Return ready sources for a conversation owned by `user_id`.

    The `owner_user_id` filter is the trust boundary: without it the
    service-role client could return any user's rows.
    """
    rows = store._get(
        "sources",
        params={
            "select": "id,conversation_id,filename,mime_type,storage_bucket,storage_path,size_bytes,processing_status",
            "conversation_id": f"eq.{conversation_id}",
            "owner_user_id": f"eq.{user_id}",
            "processing_status": "eq.ready",
            "order": "created_at.asc",
        },
    )
    records: list[SourceRecord] = []
    for row in rows or []:
        try:
            records.append(_row_to_record(row))
        except (KeyError, ValueError, TypeError) as exc:
            logger.warning("skipping malformed source row: %s", exc)
    return records


def download_source_bytes(store: Any, source: SourceRecord) -> bytes:
    """Download raw bytes for a source object from Supabase Storage.

    Uses the store's existing httpx client (already authenticated with the
    service-role key). Returns the body on 2xx, raises httpx.HTTPStatusError
    otherwise — callers are expected to catch and continue.
    """
    url = f"{store._base_url}/storage/v1/object/{source.storage_bucket}/{source.storage_path}"
    response = store._client.get(url)
    response.raise_for_status()
    return response.content


def _decode_text(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")


def _extract_pdf_text(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:  # pragma: no cover — surface clearly if dep is missing
        logger.error("pypdf is not installed; cannot extract PDF text")
        return ""

    try:
        reader = PdfReader(BytesIO(data))
    except Exception as exc:  # malformed PDF
        logger.warning("pypdf could not open PDF: %s", exc)
        return ""

    if getattr(reader, "is_encrypted", False):
        logger.warning("skipping encrypted PDF")
        return ""

    parts: list[str] = []
    for index, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception as exc:  # per-page extraction is best-effort
            logger.warning("pypdf page %d extraction failed: %s", index, exc)
            continue
        if text:
            parts.append(text)
    return "\n\n".join(parts)


def extract_text_from_source(
    filename: str,
    mime_type: str,
    data: bytes,
    max_chars: int = DEFAULT_PER_SOURCE_CHARS,
) -> str:
    """Best-effort text extraction. Returns '' when the type is unsupported
    or extraction fails; never raises."""
    mime = (mime_type or "").lower().strip()
    name_lower = (filename or "").lower()

    if mime.startswith("text/") or mime in {"application/json", "application/xml"}:
        text = _decode_text(data)
    elif mime == "application/pdf" or name_lower.endswith(".pdf"):
        text = _extract_pdf_text(data)
    else:
        return ""

    text = text.strip()
    if not text:
        return ""
    if max_chars > 0 and len(text) > max_chars:
        text = text[:max_chars].rstrip() + TRUNCATION_MARKER
    return text


def build_sources_context(
    store: Any,
    conversation_id: str,
    user_id: str,
    *,
    per_source_chars: int = DEFAULT_PER_SOURCE_CHARS,
    total_chars: int = DEFAULT_TOTAL_CHARS,
) -> str:
    """Fetch every ready source for the conversation, extract text, and
    render a single markdown block suitable for appending to an LLM user
    message. Returns '' if there is nothing to include."""
    sources = list_conversation_sources(store, conversation_id, user_id)
    if not sources:
        return ""

    rendered: list[str] = []
    remaining = total_chars
    for idx, source in enumerate(sources, start=1):
        if remaining <= 0:
            rendered.append(
                f"### {idx}. {source.filename} ({source.mime_type})\n"
                "[omitted: total source budget exhausted]"
            )
            continue

        try:
            data = download_source_bytes(store, source)
        except (httpx.HTTPError, httpx.HTTPStatusError) as exc:
            logger.warning("could not download source %s: %s", source.id, exc)
            rendered.append(
                f"### {idx}. {source.filename} ({source.mime_type})\n"
                "[omitted: download failed]"
            )
            continue

        budget = min(per_source_chars, remaining)
        text = extract_text_from_source(source.filename, source.mime_type, data, max_chars=budget)
        if not text:
            rendered.append(
                f"### {idx}. {source.filename} ({source.mime_type})\n"
                "[omitted: unsupported format or empty extraction]"
            )
            continue

        rendered.append(f"### {idx}. {source.filename} ({source.mime_type})\n{text}")
        remaining -= len(text)

    if not rendered:
        return ""

    return "## Attached sources\n\n" + "\n\n".join(rendered)
