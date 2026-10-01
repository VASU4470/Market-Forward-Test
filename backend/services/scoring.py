from ..data.supabase_rest import rpc
from ..errors import ApiError

RULE_VERSION = "p2-v1"


def calculate_score(prediction, actual):
    support = float(prediction["support"])
    resistance = float(prediction["resistance"])
    support_tolerance = max(25, support * 0.0025)
    resistance_tolerance = max(25, resistance * 0.0025)
    detail = {
        "bias": 25 if prediction["bias"] == actual["actual_bias"] else 0,
        "opening": 20 if prediction["opening_view"] == actual["actual_opening"] else 0,
        "day_type": 20 if prediction["day_type"] == actual["actual_day_type"] else 0,
        "support": max(0, 17.5 * (1 - abs(float(actual["low"]) - support) / support_tolerance)),
        "resistance": max(0, 17.5 * (1 - abs(float(actual["high"]) - resistance) / resistance_tolerance)),
    }
    return {
        "total": round(sum(detail.values())),
        "detail": detail,
        "rule_version": RULE_VERSION,
    }


def score_prediction(user, prediction_id):
    if not prediction_id:
        raise ApiError(400, "PREDICTION_ID_REQUIRED", "A prediction ID is required.")
    result = rpc("score_prediction", user["token"], {"p_prediction_id": prediction_id})
    if isinstance(result, list) and len(result) == 1:
        result = result[0]
    if not result:
        raise ApiError(404, "PREDICTION_NOT_FOUND", "The prediction was not found for this account.")
    return result
