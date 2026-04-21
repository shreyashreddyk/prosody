from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
from pypdf import PdfWriter

from app.storage.sources import (
    build_sources_context,
    extract_text_from_source,
    list_conversation_sources,
)


USER_ID = "00000000-0000-0000-0000-000000000001"
OTHER_USER_ID = "00000000-0000-0000-0000-000000000099"
CONV_ID = "11111111-1111-1111-1111-111111111111"


def _make_store(rows, download_map):
    """Return a store stub whose `_get` returns `rows` and whose `_client.get`
    returns the bytes in `download_map` keyed by URL substring."""
    recorded_get_calls: list[dict] = []

    def _get(table, params):
        recorded_get_calls.append({"table": table, "params": params})
        return rows

    def _client_get(url):
        for needle, body in download_map.items():
            if needle in url:
                return httpx.Response(200, content=body, request=httpx.Request("GET", url))
        return httpx.Response(404, request=httpx.Request("GET", url))

    client = MagicMock()
    client.get.side_effect = _client_get

    store = SimpleNamespace(
        _get=_get,
        _client=client,
        _base_url="https://example.supabase.co",
        _recorded=recorded_get_calls,
    )
    return store


def _minimal_pdf(text: str) -> bytes:
    """Emit a tiny valid PDF. Text extraction from a blank page is empty,
    so for the happy-path PDF test we stub `extract_text_from_source`
    instead. This fixture is only used to prove pypdf can *open* the bytes
    without raising."""
    buf = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.write(buf)
    return buf.getvalue()


def test_list_conversation_sources_filters_by_owner_and_ready():
    rows = [
        {
            "id": "s1",
            "conversation_id": CONV_ID,
            "filename": "resume.txt",
            "mime_type": "text/plain",
            "storage_bucket": "conversation-sources",
            "storage_path": f"user/{USER_ID}/conversations/{CONV_ID}/sources/s1/resume.txt",
            "size_bytes": 10,
            "processing_status": "ready",
        }
    ]
    store = _make_store(rows, {})

    records = list_conversation_sources(store, CONV_ID, USER_ID)

    assert len(records) == 1
    assert records[0].id == "s1"
    # The owner + ready filters are the security boundary; assert both are sent.
    call = store._recorded[0]
    assert call["table"] == "sources"
    assert call["params"]["conversation_id"] == f"eq.{CONV_ID}"
    assert call["params"]["owner_user_id"] == f"eq.{USER_ID}"
    assert call["params"]["processing_status"] == "eq.ready"


def test_extract_text_from_source_handles_text_and_pdf():
    plain = extract_text_from_source("notes.md", "text/markdown", b"# Hello\nworld")
    assert "Hello" in plain and "world" in plain

    pdf_bytes = _minimal_pdf("irrelevant")
    # Blank page → empty extraction returns ''. We only assert we don't raise.
    assert extract_text_from_source("blank.pdf", "application/pdf", pdf_bytes) == ""

    unsupported = extract_text_from_source("image.png", "image/png", b"\x89PNG")
    assert unsupported == ""


def test_extract_text_from_source_truncates_over_budget():
    big = ("a" * 10_000).encode("utf-8")
    out = extract_text_from_source("big.txt", "text/plain", big, max_chars=100)
    assert len(out) <= 100 + len("\n\n… [truncated]")
    assert out.endswith("[truncated]")


def test_build_sources_context_returns_empty_when_no_ready_sources():
    store = _make_store([], {})
    assert build_sources_context(store, CONV_ID, USER_ID) == ""


def test_build_sources_context_renders_markdown_block_with_text_source():
    rows = [
        {
            "id": "s1",
            "conversation_id": CONV_ID,
            "filename": "resume.md",
            "mime_type": "text/markdown",
            "storage_bucket": "conversation-sources",
            "storage_path": f"user/{USER_ID}/conversations/{CONV_ID}/sources/s1/resume.md",
            "size_bytes": 42,
            "processing_status": "ready",
        }
    ]
    download_map = {"resume.md": b"# Resume\nPython, TypeScript, Pipecat."}
    store = _make_store(rows, download_map)

    block = build_sources_context(store, CONV_ID, USER_ID)

    assert block.startswith("## Attached sources")
    assert "### 1. resume.md (text/markdown)" in block
    assert "Pipecat" in block

    # Confirm the download URL used the configured bucket + path.
    called_url = store._client.get.call_args_list[0].args[0]
    assert "/storage/v1/object/conversation-sources/" in called_url
    assert "resume.md" in called_url


def test_build_sources_context_marks_download_failures_without_aborting():
    rows = [
        {
            "id": "s1",
            "conversation_id": CONV_ID,
            "filename": "bad.txt",
            "mime_type": "text/plain",
            "storage_bucket": "conversation-sources",
            "storage_path": f"user/{USER_ID}/conversations/{CONV_ID}/sources/s1/bad.txt",
            "size_bytes": 1,
            "processing_status": "ready",
        },
        {
            "id": "s2",
            "conversation_id": CONV_ID,
            "filename": "good.txt",
            "mime_type": "text/plain",
            "storage_bucket": "conversation-sources",
            "storage_path": f"user/{USER_ID}/conversations/{CONV_ID}/sources/s2/good.txt",
            "size_bytes": 5,
            "processing_status": "ready",
        },
    ]
    # First URL (bad.txt) 404s; second (good.txt) succeeds.
    download_map = {"good.txt": b"hello"}
    store = _make_store(rows, download_map)

    block = build_sources_context(store, CONV_ID, USER_ID)

    assert "### 1. bad.txt (text/plain)" in block
    assert "download failed" in block
    assert "### 2. good.txt (text/plain)" in block
    assert "hello" in block


def test_build_sources_context_respects_total_budget():
    rows = [
        {
            "id": "s1",
            "conversation_id": CONV_ID,
            "filename": "a.txt",
            "mime_type": "text/plain",
            "storage_bucket": "conversation-sources",
            "storage_path": "p/a.txt",
            "size_bytes": 1000,
            "processing_status": "ready",
        },
        {
            "id": "s2",
            "conversation_id": CONV_ID,
            "filename": "b.txt",
            "mime_type": "text/plain",
            "storage_bucket": "conversation-sources",
            "storage_path": "p/b.txt",
            "size_bytes": 1000,
            "processing_status": "ready",
        },
    ]
    download_map = {"a.txt": ("a" * 1000).encode(), "b.txt": ("b" * 1000).encode()}
    store = _make_store(rows, download_map)

    block = build_sources_context(
        store, CONV_ID, USER_ID, per_source_chars=2000, total_chars=500
    )

    assert "### 1. a.txt" in block
    # Second source should be omitted entirely or marked budget-exhausted.
    assert "### 2. b.txt" in block
    assert "budget exhausted" in block
