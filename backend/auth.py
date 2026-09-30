import json
import urllib.error
import urllib.request

from .config import supabase_publishable_key, supabase_url
from .errors import ApiError


def bearer_token(headers):
    value = headers.get("Authorization", "")
    scheme, _, token = value.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise ApiError(401, "AUTH_REQUIRED", "A valid Supabase access token is required.")
    return token.strip()


def require_user(headers):
    token = bearer_token(headers)
    url = supabase_url()
    key = supabase_publishable_key()
    if not url or not key:
        raise ApiError(503, "SUPABASE_NOT_CONFIGURED", "Supabase is not configured on the server.")
    request = urllib.request.Request(
        f"{url}/auth/v1/user",
        headers={"apikey": key, "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            user = json.load(response)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise ApiError(401, "AUTH_INVALID", "The Supabase access token is invalid or expired.")
        raise ApiError(502, "AUTH_PROVIDER_ERROR", "Supabase authentication could not be verified.")
    except (urllib.error.URLError, TimeoutError):
        raise ApiError(502, "AUTH_PROVIDER_UNAVAILABLE", "Supabase authentication is temporarily unavailable.")
    user_id = user.get("id")
    if not user_id:
        raise ApiError(401, "AUTH_INVALID", "The authenticated user could not be identified.")
    return {"id": user_id, "email": user.get("email"), "token": token, "raw": user}
