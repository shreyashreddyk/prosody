from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings
from app.models import AuthenticatedUser


@dataclass
class SupabaseAuthenticator:
    settings: Settings

    def __post_init__(self) -> None:
        if not self.settings.supabase_url:
            raise ValueError("SUPABASE_URL is required for auth")
        self._jwks_url = f"{self.settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        self._jwk_client = jwt.PyJWKClient(self._jwks_url)

    def validate(self, token: str) -> AuthenticatedUser:
        try:
            signing_key = self._jwk_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "RS256"],
                options={"verify_aud": False},
            )
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid auth token") from exc

        subject = payload.get("sub")
        if not subject:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing auth subject")

        return AuthenticatedUser(id=subject, email=payload.get("email"))


bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AuthenticatedUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    authenticator: SupabaseAuthenticator = request.app.state.authenticator
    return authenticator.validate(credentials.credentials)
