import copy
import base64
import hashlib
import io
import json
import json
import os
import unittest
import urllib.error
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

from backend.errors import ApiError
from backend.market_data.api import manual_result, require_admin, run_job
from backend.market_data.calendar import IST, require_closed, session_window
from backend.market_data.collector import collect
from backend.market_data.normalize import normalize
from backend.market_data.oidc import InvalidIdentity, verify_github_token
from backend.market_data.provider import DataUnavailable, SessionWindow
from backend.market_data.repository import rpc
from backend.market_data.upstox import DEFAULT_INSTRUMENTS, Upstox, instrument_key
from backend.routes.api import dispatch, parse_body

DAY = date(2026, 10, 5)
START = datetime(2026, 10, 5, 9, 15, tzinfo=IST)
END = START + timedelta(minutes=375)
NOW = END + timedelta(hours=1)
WINDOW = SessionWindow(START, END, {})
JOB = {'id': 'index1', 'job_id': 'job1', 'lease_token': 'lease', 'code': 'NIFTY50',
       'exchange': 'NSE', 'trading_date': DAY.isoformat(), 'attempts': 1}


def fixture():
    candles = [[(START + timedelta(minutes=15*i)).isoformat(), 100, 105, 95, 101, 0] for i in range(25)]
    return {'daily': {'data': {'candles': [
        ['2026-10-02T00:00:00+05:30', 100, 105, 95, 100, 0],
        ['2026-10-05T00:00:00+05:30', 100, 105, 95, 101, 0],
    ]}}, 'intraday': {'data': {'candles': candles}}}


class FakeProvider:
    name = 'upstox'

    def session(self, exchange, day):
        if day.weekday() >= 5:
            raise DataUnavailable('NON_TRADING_DAY')
        return WINDOW

    def candles(self, *args):
        return fixture()


class FakeRepository:
    def __init__(self):
        self.result = None
        self.finishes = []
        self.calls = 0

    def claim(self, name):
        return [dict(JOB, existing_session=bool(self.result))]

    def publish(self, result):
        self.calls += 1
        self.result = self.result or result

    def finish(self, *args):
        self.finishes.append(args)


class Priority3Tests(unittest.TestCase):
    # Disposable test key only; GitHub's live signing keys are fetched at runtime.
    TEST_RSA_N = 'r4xPBocB81oSt4jIm92yrISgXc0rpLO18ZocuOfROYhudafIQ-tcfyS_VGVxesWwPIDyWiXrmYAqobOeqX9ve4caQjp0FyxIBlkC58jNxuZ51dWfcn9MWXUVdP9piIu_3z4uKcARUX0n2RHQ4MZjEs1EBvSFKbD9947o09znKxPg3E3yAKGxkgWsFOotqznUWJYL0-YVbhJTU8itUYfK3x7xtbeR2koZiVi9avQbwRk3_LbIl_Jc5kbFyOvc0jMXj8j5ZIrSzvB3hksZXGacka_hOduWPHjxj57UKhqCzxqV85PQ12SdIAp5v2dbPvz5anLdYLdfxxNVQCNTyMWG0Q'
    TEST_RSA_D = 'Aix3GAoY7JX7cFlZvpBWs4sq3y54sV_mS1kQrPt13EQDtiI_ORQTf6GJWvasmowTHBSuq44Xpj1vibQLLWceDsYD_bjykgzi0W1Nu2gBoEpfTNYJ1OWdoOfxvZKiEGZGmHGRKcQukrc9hJMTZo0eUe_HvVxOv87oviV_XYw5Mo_Vs1pe5uzS_GCiBd8bqcifTBubm5O1zXV6iPsKn6JvIaYeiZjWq3qgIt0aBh-UzCYmpTELB1qKp6HJtwrkAwl2lu1w_sYxyjAQWiLbUyT8DYG1AifUbHFw_-GGbbWC_Bbh5MWACWCSAG0Qvarc6F7s868dT8UDzSHQLmJrdDmnSQ'

    @classmethod
    def signed_oidc_token(cls, claims, corrupt=False):
        def b64(data):
            return base64.urlsafe_b64encode(data).rstrip(b'=').decode()
        header = b64(json.dumps({'alg':'RS256','kid':'test-key','typ':'JWT'},separators=(',',':')).encode())
        payload = b64(json.dumps(claims,separators=(',',':')).encode())
        message = (header+'.'+payload).encode()
        digest_info = bytes.fromhex('3031300d060960864801650304020105000420') + hashlib.sha256(message).digest()
        n = int.from_bytes(base64.urlsafe_b64decode(cls.TEST_RSA_N+'='*(-len(cls.TEST_RSA_N)%4)),'big')
        d = int.from_bytes(base64.urlsafe_b64decode(cls.TEST_RSA_D+'='*(-len(cls.TEST_RSA_D)%4)),'big')
        encoded = b'\x00\x01' + b'\xff'*(256-len(digest_info)-3) + b'\x00' + digest_info
        signature = b64(pow(int.from_bytes(encoded,'big'),d,n).to_bytes(256,'big'))
        if corrupt:
            signature = b64(bytes([0])*256)
        return header+'.'+payload+'.'+signature

    def normalize(self, raw=None):
        return normalize(JOB, 'upstox', DEFAULT_INSTRUMENTS['NIFTY50'], DAY, WINDOW, raw or fixture(), NOW)

    def test_complete_session_preserves_provenance_and_classification(self):
        result = self.normalize()
        self.assertEqual(result['fetch_status'], 'valid')
        self.assertEqual(result['close'], 101)
        self.assertEqual(result['actual_bias'], 'Bullish')
        self.assertEqual(result['actual_day_type'], 'Range')
        self.assertEqual(result['methodology']['intraday_count'], 25)
        self.assertEqual(result['raw_market_data'], fixture())

    def test_missing_duplicate_wrong_date_or_unzoned_bars_cannot_score(self):
        for mutation in ('missing', 'duplicate', 'wrong_date', 'unzoned', 'nan', 'invalid_ohlc'):
            with self.subTest(mutation=mutation):
                raw = fixture()
                bars = raw['intraday']['data']['candles']
                if mutation == 'missing': bars.pop()
                if mutation == 'duplicate': bars[1] = bars[0]
                if mutation == 'wrong_date': bars[0][0] = '2026-10-04T09:15:00+05:30'
                if mutation == 'unzoned': bars[0][0] = '2026-10-05T09:15:00'
                if mutation == 'nan': bars[0][1] = 'NaN'
                if mutation == 'invalid_ohlc': bars[0][3] = 110
                with self.assertRaises(DataUnavailable): self.normalize(raw)

    def test_daily_and_previous_close_are_required(self):
        for position in (0, 1):
            raw = fixture()
            raw['daily']['data']['candles'].pop(position)
            with self.assertRaises(DataUnavailable): self.normalize(raw)

    def test_daily_close_is_not_replaced_by_last_intraday_close(self):
        raw = fixture()
        raw['daily']['data']['candles'][1][4] = 102
        self.assertEqual(self.normalize(raw)['close'], 102)

    def test_weekends_holidays_and_special_sessions(self):
        saturday = date(2026, 10, 3)
        with self.assertRaises(DataUnavailable) as error:
            session_window('NSE', saturday, [], [])
        self.assertEqual(error.exception.code, 'NON_TRADING_DAY')
        closed = [{'date': DAY.isoformat(), 'closed_exchanges': ['NSE']}]
        with self.assertRaises(DataUnavailable): session_window('NSE', DAY, [], closed)
        start = START - timedelta(days=2)
        row = {'exchange': 'NSE', 'start_time': start.timestamp()*1000,
               'end_time': (start+timedelta(hours=1)).timestamp()*1000}
        special = [{'date': saturday.isoformat(), 'closed_exchanges': ['NSE'], 'open_exchanges': [row]}]
        window = session_window('NSE', saturday, [], special)
        self.assertEqual(window.opens_at, start)

    def test_missing_calendar_is_not_a_weekday_holiday(self):
        with self.assertRaises(DataUnavailable) as error:
            session_window('NSE', DAY, [], [])
        self.assertEqual(error.exception.code, 'CALENDAR_UNAVAILABLE')

    def test_close_grace_and_timezone(self):
        with self.assertRaises(DataUnavailable): require_closed(WINDOW, END+timedelta(minutes=29))
        require_closed(WINDOW, (END+timedelta(minutes=30)).astimezone(timezone.utc))

    def test_duplicate_collection_reuses_stored_session(self):
        repo, provider = FakeRepository(), FakeProvider()
        collect(provider, repo, NOW)
        with patch.object(provider, 'candles', side_effect=AssertionError('Must not fetch twice')):
            collect(provider, repo, NOW)
        self.assertEqual(repo.calls, 2)  # second publication performs idempotent catch-up scoring
        self.assertEqual(repo.finishes[-1][1], 'success')

    def test_provider_failure_never_publishes_and_retry_is_durable(self):
        repo, provider = FakeRepository(), FakeProvider()
        with patch.object(provider, 'candles', side_effect=DataUnavailable('PROVIDER_RATE_LIMIT', 4000)):
            result = collect(provider, repo, NOW)
        self.assertIsNone(repo.result)
        self.assertEqual(result[0]['status'], 'retry')
        self.assertEqual(repo.finishes[0][3], 4000)

    def test_missing_intervening_session_rejects_stale_previous_close(self):
        repo, provider = FakeRepository(), FakeProvider()
        raw = fixture()
        raw['daily']['data']['candles'][0][0] = '2026-10-01T00:00:00+05:30'
        with patch.object(provider, 'candles', return_value=raw):
            result = collect(provider, repo, NOW)
        self.assertEqual(result[0]['error'], 'PREVIOUS_CLOSE_MISSING')
        self.assertIsNone(repo.result)

    def test_five_mappings_and_server_override(self):
        self.assertEqual(len(DEFAULT_INSTRUMENTS), 5)
        with patch.dict(os.environ, {'UPSTOX_INSTRUMENT_NIFTY50': 'NSE_INDEX|Configured'}):
            self.assertEqual(instrument_key(JOB), 'NSE_INDEX|Configured')
        with patch.dict(os.environ, {'UPSTOX_INSTRUMENT_NIFTY50': 'https://evil.example'}):
            with self.assertRaises(DataUnavailable): instrument_key(JOB)

    @patch.dict(os.environ, {'UPSTOX_ANALYTICS_TOKEN': 'secret-value'})
    @patch('backend.market_data.upstox.time.sleep')
    def test_rate_limit_auth_and_network_errors_do_not_expose_credentials(self, sleep):
        for status, code in ((429, 'PROVIDER_RATE_LIMIT'), (401, 'PROVIDER_AUTH_FAILED'), (503, 'PROVIDER_HTTP_503')):
            error = urllib.error.HTTPError('secret-url', status, 'secret-value', {'Retry-After':'600'}, io.BytesIO())
            with patch('urllib.request.urlopen', side_effect=error):
                with self.assertRaises(DataUnavailable) as caught: Upstox().get('/v2/market/holidays')
            self.assertEqual(caught.exception.code, code)
            self.assertNotIn('secret', str(caught.exception))

    @patch.dict(os.environ, {'MARKET_COLLECTION_ENABLED':'true'})
    def test_job_endpoint_rejects_missing_and_wrong_secrets(self):
        for headers in ({}, {'Authorization':'Bearer wrong'}):
            with self.assertRaises(ApiError): run_job(headers)
        with patch('backend.market_data.api.verify_github_token') as verify, patch('backend.market_data.api.collect', return_value=[]) as run:
            self.assertEqual(run_job({'Authorization':'Bearer '+'x'*40}), {'results':[]})
        run.assert_called_once()
        verify.assert_called_once()

    def test_collector_rejects_unverified_oidc_identities(self):
        for token in ('', 'header.payload.signature', 'eyJhbGciOiJub25lIn0.e30.'):
            with self.subTest(token=token), self.assertRaises(InvalidIdentity):
                verify_github_token(token, now=1_800_000_000)

    def test_github_oidc_signature_and_repository_scope(self):
        now = 1_800_000_000
        claims = {'iss':'https://token.actions.githubusercontent.com','aud':'market-forward-test-collector',
            'repository':'VASU4470/Market-Forward-Test','repository_owner':'VASU4470',
            'workflow_ref':'VASU4470/Market-Forward-Test/.github/workflows/market-collection.yml@refs/heads/main',
            'ref':'refs/heads/main','event_name':'schedule','iat':now-10,'nbf':now-5,'exp':now+60}
        jwks = {'keys':[{'kid':'test-key','kty':'RSA','alg':'RS256','n':self.TEST_RSA_N,'e':'AQAB'}]}
        with patch('backend.market_data.oidc._keys',return_value=jwks):
            self.assertTrue(verify_github_token(self.signed_oidc_token(claims),now))
            for changes, corrupt in (({'repository':'attacker/other'},False),
                ({'aud':'wrong-audience'},False),({'event_name':'pull_request'},False),
                ({'exp':now-1},False),({},True)):
                with self.subTest(changes=changes,corrupt=corrupt), self.assertRaises(InvalidIdentity):
                    verify_github_token(self.signed_oidc_token({**claims,**changes},corrupt),now)

    @patch.dict(os.environ, {'MARKET_ADMIN_USER_IDS':'admin-id','MARKET_COLLECTION_ENABLED':'true'})
    def test_administrator_cannot_be_self_declared(self):
        with self.assertRaises(ApiError): require_admin({'id':'attacker','raw':{'user_metadata':{'role':'admin'}}})
        require_admin({'id':'admin-id'})
        with self.assertRaises(ApiError): manual_result({'id':'attacker'}, {})

    def test_provider_client_cannot_call_arbitrary_privileged_operations(self):
        with self.assertRaises(ValueError): rpc('score_prediction', {})

    def test_result_requires_authentication(self):
        handler = type('H', (), {'headers':{}, 'path':'/api/v1/market-result'})()
        with self.assertRaises(ApiError): dispatch(handler, 'GET', handler.path)

    def test_admin_json_body_is_bounded(self):
        handler = type('H', (), {'headers':{'Content-Length':'262145'},'rfile':io.BytesIO()})()
        with self.assertRaises(ApiError) as error: parse_body(handler)
        self.assertEqual(error.exception.status, 413)

    @patch.dict(os.environ, {'MARKET_ADMIN_USER_IDS':'admin-id','MARKET_COLLECTION_ENABLED':'true'})
    def test_manual_fallback_validates_and_computes_classification_server_side(self):
        raw = fixture()
        body = {'index_code':'NIFTY50', 'trading_date':DAY.isoformat(),
                'session_open_at':START.isoformat(), 'session_close_at':END.isoformat(),
                'previous_daily_candle':raw['daily']['data']['candles'][0],
                'daily_candle':raw['daily']['data']['candles'][1],
                'intraday_candles':raw['intraday']['data']['candles'],
                'reason':'Reviewed independent authorized source', 'source_reference':'report-1',
                'confirmation':'PUBLISH NIFTY50 ' + DAY.isoformat(), 'score':0, 'actual_bias':'Bearish'}
        index = dict(JOB, provider_instrument_key=DEFAULT_INSTRUMENTS['NIFTY50'])
        with patch('backend.market_data.api.find_index', return_value=index), patch('backend.market_data.api.Repository') as repo:
            manual_result({'id':'admin-id'}, body)
            sent = repo.return_value.publish.call_args.args[0]
            self.assertEqual(sent['fetch_status'],'manual')
            self.assertEqual(sent['actual_bias'],'Bullish')
            self.assertNotIn('score',sent)
            self.assertEqual(sent['methodology']['administrator_id'],'admin-id')
            body['intraday_candles'] = []
            with self.assertRaises(DataUnavailable): manual_result({'id':'admin-id'}, body)
            self.assertEqual(repo.return_value.publish.call_count,1)

    def test_current_day_uses_intraday_endpoint_and_past_day_uses_historical(self):
        source = Upstox()
        with patch.object(source,'get',return_value={'status':'success','data':{'candles':[]}}) as get:
            source.candles('NSE_INDEX|Nifty 50',DAY,NOW)
            self.assertIn('/intraday/NSE_INDEX%7CNifty%2050/minutes/15',get.call_args.args[0])
            source.candles('NSE_INDEX|Nifty 50',DAY,NOW+timedelta(days=1))
            self.assertTrue(get.call_args.args[0].endswith('/minutes/15/2026-10-05/2026-10-05'))


if __name__ == '__main__':
    unittest.main()
