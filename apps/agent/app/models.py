from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    service: str


class ProviderConfigState(BaseModel):
    deepgram_configured: bool
    elevenlabs_configured: bool
    daily_configured: bool
    supabase_configured: bool


class MetaResponse(BaseModel):
    service: str
    version: str
    realtime_status: str
    intended_local_transport: str
    intended_deployed_transport: str
    provider_config: ProviderConfigState
