from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.routes import router as api_router
from app.config import Settings
from app.sessions.manager import SessionManager
from app.storage.local_store import LocalSessionStore


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings.from_env()
    store = LocalSessionStore(settings.data_dir)
    app.state.settings = settings
    app.state.store = store
    app.state.session_manager = SessionManager(settings, store)
    yield
    await app.state.session_manager.close()


app = FastAPI(
    title="Prosody Agent",
    version="0.1.0",
    description="Local realtime FastAPI orchestrator for the Prosody v1 voice loop.",
    lifespan=lifespan,
)
app.include_router(api_router)
