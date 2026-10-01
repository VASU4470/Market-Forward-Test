from datetime import date

from ..data.supabase_rest import insert, select, update
from ..errors import ApiError


def _validate_duration(value):
    try:
        duration = int(value)
    except (TypeError, ValueError):
        raise ApiError(400, "TEST_PERIOD_INVALID", "Duration must be a whole number from 1 to 365.")
    if duration < 1 or duration > 365:
        raise ApiError(400, "TEST_PERIOD_INVALID", "Duration must be a whole number from 1 to 365.")
    return duration


def create_test_period(user, payload):
    start_date = payload.get("start_date")
    if not start_date:
        raise ApiError(400, "TEST_PERIOD_INVALID", "A start date is required.")
    try:
        date.fromisoformat(start_date)
    except (TypeError, ValueError):
        raise ApiError(400, "TEST_PERIOD_INVALID", "Start date must use YYYY-MM-DD.")
    duration = _validate_duration(payload.get("duration_sessions"))
    data = {
        "user_id": user["id"],
        "start_date": start_date,
        "duration_sessions": duration,
        "status": "scheduled" if start_date > date.today().isoformat() else "active",
    }
    rows = insert("test_periods", user["token"], data) or []
    return rows[0] if isinstance(rows, list) and rows else rows


def get_my_test_periods(user):
    return select("test_periods", user["token"], {
        "select": "id,start_date,duration_sessions,end_date,status,created_at,completed_at",
        "user_id": f"eq.{user['id']}",
        "order": "created_at.desc",
    })


def update_test_period(user, period_id, payload):
    allowed = {"status", "end_date", "completed_at"}
    data = {key: payload[key] for key in allowed if key in payload}
    if "status" in data and data["status"] not in {"scheduled", "active", "completed", "stopped"}:
        raise ApiError(400, "TEST_PERIOD_INVALID", "Unsupported test period status.")
    if not data:
        raise ApiError(400, "TEST_PERIOD_EMPTY", "No test period fields were provided.")
    rows = update("test_periods", user["token"], {
        "id": f"eq.{period_id}",
        "user_id": f"eq.{user['id']}",
    }, data) or []
    return rows[0] if isinstance(rows, list) and rows else rows
