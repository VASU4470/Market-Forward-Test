from ..data.supabase_rest import select, upsert, update
from ..errors import ApiError


def get_profile(user):
    rows = select("profiles", user["token"], {"select": "*", "id": f"eq.{user['id']}", "limit": "1"})
    return rows[0] if rows else None


def update_profile(user, payload):
    allowed = {"username", "display_name", "mobile_number", "preferred_language", "onboarding", "ranking_opt_in", "profile_completed"}
    data = {key: value for key, value in payload.items() if key in allowed}
    if not data:
        raise ApiError(400, "PROFILE_EMPTY", "No editable profile fields were provided.")
    data["id"] = user["id"]
    try:
        rows = upsert("profiles", user["token"], data, "id") or []
    except ApiError:
        raise
    return rows[0] if isinstance(rows, list) and rows else rows
