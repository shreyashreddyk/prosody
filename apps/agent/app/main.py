from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth import SupabaseAuthenticator
from app.api.routes import router as api_router
from app.api.generation import router as generation_router
from app.config import Settings
from app.sessions.manager import SessionManager
from app.storage.local_store import LocalSessionStore
from app.storage.supabase_store import SupabaseSessionStore


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings.from_env()
    if settings.supabase_url and settings.supabase_service_role_key:
        store = SupabaseSessionStore(settings)
        app.state.authenticator = SupabaseAuthenticator(settings)
    else:
        store = LocalSessionStore(settings.data_dir)
    app.state.settings = settings
    app.state.store = store
    app.state.session_manager = SessionManager(settings, store)
    yield
    await app.state.session_manager.close()
    close = getattr(store, "close", None)
    if callable(close):
        close()
    authenticator_close = getattr(getattr(app.state, "authenticator", None), "close", None)
    if callable(authenticator_close):
        authenticator_close()


app = FastAPI(
    title="Prosody Agent",
    version="0.1.0",
    description="Authenticated realtime FastAPI orchestrator for the Prosody v3 persistent product surface.",
    lifespan=lifespan,
)
settings = Settings.from_env()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.web_allowed_origins,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(api_router)
app.include_router(generation_router)
