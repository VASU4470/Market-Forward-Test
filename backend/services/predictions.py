from ..data.supabase_rest import insert, select
from ..errors import ApiError
from .forecast_calendar import ensure_forecast_calendar


def create_prediction(user, payload):
    required = ("index_id", "trading_date", "bias", "opening_view", "day_type", "support", "resistance")
    missing = [key for key in required if payload.get(key) in (None, "")]
    if missing:
        raise ApiError(400, "PREDICTION_INVALID", "Missing prediction fields: " + ", ".join(missing))
    data = {key: payload.get(key) for key in required}
    if payload.get('submission_kind') == 'import':
        data['submission_kind'] = 'import'
        if 'import_metadata' in payload:
            if not isinstance(payload['import_metadata'],dict):
                raise ApiError(400,'PREDICTION_INVALID','Historical metadata must be an object.')
            data['import_metadata'] = payload['import_metadata']
    if payload.get("test_period_id"):
        data["test_period_id"] = payload["test_period_id"]
    data["user_id"] = user["id"]
    ensure_forecast_calendar(user, data)
    rows = insert("predictions", user["token"], data) or []
    return rows[0] if isinstance(rows, list) and rows else rows


def get_my_predictions(user, query_params):
    query = {
        "select": "*",
        "user_id": f"eq.{user['id']}",
        "order": "trading_date.desc,locked_at.desc",
    }
    if query_params.get("index_id"):
        query["index_id"] = f"eq.{query_params['index_id']}"
    if query_params.get("limit"):
        query["limit"] = query_params["limit"]
    return select("predictions", user["token"], query)
