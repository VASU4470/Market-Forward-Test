import json
import urllib.error
import urllib.parse
import urllib.request

from ..config import supabase_publishable_key, supabase_url
from ..errors import ApiError


def _request(method, table, token, query=None, payload=None, prefer=None):
    base = f"{supabase_url()}/rest/v1/{table}"
    if query:
        base += "?" + urllib.parse.urlencode(query, doseq=True)
    effective_token = token or supabase_publishable_key()
    headers = {
        "apikey": supabase_publishable_key(),
        "Authorization": f"Bearer {effective_token}",
        "Accept": "application/json",
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(base, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8")) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read(2000).decode("utf-8", "ignore")
        if exc.code in (401, 403):
            raise ApiError(403, "DATA_FORBIDDEN", "Supabase denied access to this data.")
        if exc.code == 409:
            raise ApiError(409, "DATA_CONFLICT", "This record conflicts with existing account data.")
        if exc.code == 404:
            raise ApiError(503, "TABLE_NOT_CONFIGURED", "The required Supabase table is not available yet.")
        raise ApiError(502, "DATA_PROVIDER_ERROR", f"Supabase data request failed ({exc.code}).")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        raise ApiError(502, "DATA_PROVIDER_UNAVAILABLE", "Supabase data is temporarily unavailable.")


def select(table, token, query):
    return _request("GET", table, token, query=query) or []


def insert(table, token, payload, returning=True):
    prefer = "return=representation" if returning else "return=minimal"
    return _request("POST", table, token, payload=payload, prefer=prefer)


def upsert(table, token, payload, on_conflict, returning=True):
    query = {"on_conflict": on_conflict}
    prefer = f"resolution=merge-duplicates,{'return=representation' if returning else 'return=minimal'}"
    return _request("POST", table, token, query=query, payload=payload, prefer=prefer)


def update(table, token, query, payload, returning=True):
    prefer = "return=representation" if returning else "return=minimal"
    return _request("PATCH", table, token, query=query, payload=payload, prefer=prefer)
