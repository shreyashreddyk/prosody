from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import Settings
from app.models import AuthenticatedUser

logger = logging.getLogger(__name__)


@dataclass
class SupabaseAuthenticator:
    settings: Settings

    def __post_init__(self) -> None:
        if not self.settings.supabase_url:
            raise ValueError("SUPABASE_URL is required for auth")
        self._jwks_url = f"{self.settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        self._client = httpx.Client(timeout=10.0)
        self._jwks_by_kid: dict[str, jwt.PyJWK] = {}

    def validate(self, token: str) -> AuthenticatedUser:
        try:
            payload = self._decode(token)
        except Exception as exc:
            try:
                header = jwt.get_unverified_header(token)
            except Exception:
                header = {}
            detail = (
                f"Invalid auth token: alg={header.get('alg')} "
                f"kid={header.get('kid')} "
                f"error_type={type(exc).__name__} "
                f"error={exc}"
            )
            logger.warning(detail)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail) from exc

        subject = payload.get("sub")
        if not subject:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing auth subject")

        return AuthenticatedUser(id=subject, email=payload.get("email"))

    def _decode(self, token: str) -> dict[str, Any]:
        header = jwt.get_unverified_header(token)
        algorithm = header.get("alg")

        if algorithm == "HS256":
            if not self.settings.supabase_jwt_secret:
                raise ValueError("SUPABASE_JWT_SECRET is required for HS256 Supabase tokens")
            return jwt.decode(
                token,
                self.settings.supabase_jwt_secret,
                algorithms=["HS256"],
                options={"verify_aud": False},
            )

        signing_key = self._get_signing_key(header)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            options={"verify_aud": False},
        )

    def _get_signing_key(self, header: dict[str, Any]) -> jwt.PyJWK:
        kid = header.get("kid")
        if not kid:
            raise ValueError("Missing key id in Supabase token header")
        signing_key = self._jwks_by_kid.get(kid)
        if signing_key:
            return signing_key

        response = self._client.get(self._jwks_url)
        response.raise_for_status()
        payload = response.json()
        keys = payload.get("keys", [])
        for item in keys:
            if not isinstance(item, dict):
                continue
            item_kid = item.get("kid")
            if not item_kid:
                continue
            self._jwks_by_kid[item_kid] = jwt.PyJWK.from_dict(item)

        signing_key = self._jwks_by_kid.get(kid)
        if not signing_key:
            raise ValueError(f"Unknown Supabase signing key id: {kid}")
        return signing_key

    def close(self) -> None:
        self._client.close()


bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> AuthenticatedUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    authenticator: SupabaseAuthenticator = request.app.state.authenticator
    return authenticator.validate(credentials.credentials)
