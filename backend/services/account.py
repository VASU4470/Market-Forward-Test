import os
import urllib.error
import urllib.parse
import urllib.request

from ..config import supabase_url
from ..errors import ApiError


def validate_delete_confirmation(payload):
    return payload.get("confirmation") == "DELETE MY ACCOUNT"


def delete_account(user, payload):
    if not validate_delete_confirmation(payload):
        raise ApiError(400, "DELETE_CONFIRMATION_REQUIRED", "Type DELETE MY ACCOUNT to confirm account deletion.")
    project_url = supabase_url()
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not project_url or not service_key:
        raise ApiError(503, "ACCOUNT_DELETION_NOT_CONFIGURED", "Account deletion is not configured on the server.")
    request = urllib.request.Request(
        f"{project_url}/auth/v1/admin/users/{urllib.parse.quote(user['id'])}",
        method="DELETE",
        headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20):
            return {"deleted": True}
    except urllib.error.HTTPError as exc:
        exc.read(2000)
        raise ApiError(exc.code if exc.code in (401, 403, 404) else 502, "ACCOUNT_DELETE_FAILED", "The account could not be deleted.")
    except (urllib.error.URLError, TimeoutError):
        raise ApiError(502, "ACCOUNT_DELETE_UNAVAILABLE", "The account deletion service is temporarily unavailable.")
