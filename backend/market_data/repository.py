"""Isolated service-role RPC client. No arbitrary table access or user queries."""
import json
import os
import urllib.error
import urllib.request

from ..config import supabase_url
from .provider import DataUnavailable

OPERATIONS = frozenset({'claim_market_jobs', 'finish_market_job', 'publish_market_session',
                        'get_market_collection_status', 'retry_market_job'})


def rpc(name, payload=None):
    if name not in OPERATIONS:
        raise ValueError('Unsupported collector operation')
    key = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '').strip()
    url = supabase_url()
    if not key or not url:
        raise DataUnavailable('COLLECTOR_DATABASE_NOT_CONFIGURED', 21600)
    request = urllib.request.Request(url + '/rest/v1/rpc/' + name,
        data=json.dumps(payload or {}, allow_nan=False).encode(), method='POST',
        headers={'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
        raise DataUnavailable('COLLECTOR_DATABASE_UNAVAILABLE')


class Repository:
    def claim(self, provider_name):
        return rpc('claim_market_jobs', {'p_provider': provider_name}) or []

    def publish(self, result):
        return rpc('publish_market_session', {'p_result': result})

    def finish(self, job, status, code=None, retry_after=3600):
        return rpc('finish_market_job', {'p_job_id': job['job_id'], 'p_lease': job['lease_token'],
            'p_status': status, 'p_error': code, 'p_retry_seconds': retry_after})
