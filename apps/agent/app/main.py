from fastapi import FastAPI

from app.api.routes import router as api_router


app = FastAPI(
    title="Prosody Agent",
    version="0.1.0",
    description="Minimal FastAPI scaffold for the Prosody realtime orchestrator."
)
app.include_router(api_router)
