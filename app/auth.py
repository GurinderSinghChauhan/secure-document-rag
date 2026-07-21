import hmac

from fastapi import Header, HTTPException, status

from .config import get_settings
from .models import Principal


def require_principal(
    x_api_key: str = Header(min_length=16),
    x_tenant_id: str = Header(min_length=2, max_length=64),
) -> Principal:
    for candidate_key, claims in get_settings().api_keys.items():
        if hmac.compare_digest(x_api_key, candidate_key):
            if claims.get("tenant_id") != x_tenant_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant mismatch")
            roles = claims.get("roles", [])
            if not isinstance(roles, list):
                raise HTTPException(status_code=500, detail="Invalid API key role configuration")
            return Principal(tenant_id=x_tenant_id, user_id=str(claims["user_id"]), roles=roles)
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")


def require_admin(principal: Principal) -> Principal:
    if "admin" not in principal.roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return principal
