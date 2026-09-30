import json
import urllib.parse

from ..auth import require_user
from ..errors import ApiError, error_payload
from ..services.indices import get_indices
from ..services.predictions import create_prediction, get_my_predictions
from ..services.profile import get_profile, update_profile


def parse_body(handler):
    try:
        length = int(handler.headers.get("Content-Length", "0"))
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
    if path == "/api/v1/indices" and method == "GET":
        return 200, {"indices": get_indices()}

    user = require_user(handler.headers)
    if path == "/api/v1/profile" and method == "GET":
        return 200, {"profile": get_profile(user)}
    if path == "/api/v1/profile" and method in ("PATCH", "PUT"):
        return 200, {"profile": update_profile(user, parse_body(handler))}
    if path == "/api/v1/predictions" and method == "POST":
        return 201, {"prediction": create_prediction(user, parse_body(handler))}
    if path == "/api/v1/predictions/me" and method == "GET":
        return 200, {"predictions": get_my_predictions(user, query_params(handler))}
    raise ApiError(404, "NOT_FOUND", "API endpoint not found.")


def handle(handler, method, path):
    try:
        status, payload = dispatch(handler, method, path)
    except ApiError as error:
        status, payload = error.status, error_payload(error)
    return status, payload
