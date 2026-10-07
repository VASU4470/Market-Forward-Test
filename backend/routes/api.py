import json
import urllib.parse

from ..auth import require_user
from ..errors import ApiError, error_payload
from ..market_data import api as market_api
from ..market_data.provider import DataUnavailable
from ..services.account import delete_account
from ..services.indices import get_indices
from ..services.predictions import create_prediction, get_my_predictions
from ..services.profile import get_profile, update_profile
from ..services.ranking import get_ranking
from ..services.scoring import score_prediction
from ..services.statistics import get_my_score_history, get_my_statistics, get_my_test_progress
from ..services.test_periods import create_test_period, get_my_test_periods, update_test_period


def parse_body(handler):
    try:
        length = int(handler.headers.get("Content-Length", "0"))
        if length < 0 or length > 262144:
            raise ApiError(413, "BODY_TOO_LARGE", "Request body exceeds 256 KiB.")
        raw = handler.rfile.read(length) if length else b"{}"
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError
        return value
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        raise ApiError(400, "INVALID_JSON", "Request body must be a JSON object.")


def query_params(handler):
    parsed = urllib.parse.urlparse(handler.path)
    return {key: values[0] for key, values in urllib.parse.parse_qs(parsed.query).items()}


def dispatch(handler, method, path):
    if path == "/api/v1/internal/market-collect" and method == "POST":
        return 200, market_api.run_job(handler.headers)
    if path == "/api/v1/indices" and method == "GET":
        return 200, {"indices": get_indices()}

    user = require_user(handler.headers)
    if path == "/api/v1/market-result" and method == "GET":
        return 200, market_api.market_result(user, query_params(handler))
    if path == "/api/v1/admin/market-result" and method == "POST":
        market_api.require_admin(user)
        return 200, market_api.manual_result(user, parse_body(handler))
    if path == "/api/v1/admin/market-jobs" and method == "GET":
        return 200, {"jobs": market_api.admin_status(user)}
    if path == "/api/v1/admin/market-retry" and method == "POST":
        market_api.require_admin(user)
        return 200, market_api.admin_retry(user, parse_body(handler))
    if path == "/api/v1/profile" and method == "GET":
        return 200, {"profile": get_profile(user)}
    if path == "/api/v1/profile" and method in ("PATCH", "PUT"):
        return 200, {"profile": update_profile(user, parse_body(handler))}
    if path == "/api/v1/predictions" and method == "POST":
        return 201, {"prediction": create_prediction(user, parse_body(handler))}
    if path == "/api/v1/predictions/me" and method == "GET":
        return 200, {"predictions": get_my_predictions(user, query_params(handler))}
    if path.startswith("/api/v1/predictions/") and path.endswith("/score") and method == "POST":
        prediction_id = path[len("/api/v1/predictions/"):-len("/score")].strip("/")
        return 200, {"prediction": score_prediction(user, prediction_id)}
    if path == "/api/v1/statistics" and method == "GET":
        return 200, {"statistics": get_my_statistics(user)}
    if path == "/api/v1/score-history" and method == "GET":
        return 200, {"history": get_my_score_history(user)}
    if path == "/api/v1/test-progress" and method == "GET":
        return 200, get_my_test_progress(user)
    if path == "/api/v1/test-periods" and method == "GET":
        return 200, {"test_periods": get_my_test_periods(user)}
    if path == "/api/v1/test-periods" and method == "POST":
        return 201, {"test_period": create_test_period(user, parse_body(handler))}
    if path.startswith("/api/v1/test-periods/") and method == "PATCH":
        period_id = path[len("/api/v1/test-periods/"):].strip("/")
        return 200, {"test_period": update_test_period(user, period_id, parse_body(handler))}
    if path == "/api/v1/ranking" and method == "GET":
        return 200, {"ranking": get_ranking(user)}
    if path == "/api/v1/account/delete" and method == "POST":
        return 200, delete_account(user, parse_body(handler))
    raise ApiError(404, "NOT_FOUND", "API endpoint not found.")


def handle(handler, method, path):
    try:
        status, payload = dispatch(handler, method, path)
    except ApiError as error:
        status, payload = error.status, error_payload(error)
    except DataUnavailable as error:
        status, payload = 503, {"error": error.code, "message": "Market data is not ready. The server will retry safely."}
    return status, payload
