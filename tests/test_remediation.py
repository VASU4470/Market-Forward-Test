import base64
import copy
import hashlib
import io
import json
import math
from pathlib import Path
import textwrap
import unittest
import urllib.error
from unittest.mock import patch
from . import test_priority3 as fixtures
from backend.market_data import oidc
from backend.market_data.collector import collect
from backend.market_data.provider import DataUnavailable
from backend.market_data.normalize import normalize
from backend.services.statistics import get_my_statistics,get_my_score_history

NOW=1_800_000_000
CLAIMS={'iss':oidc.ISSUER,'aud':oidc.AUDIENCE,'repository':oidc.REPOSITORY,'repository_owner':'VASU4470',
        'workflow_ref':oidc.WORKFLOW,'ref':'refs/heads/main','event_name':'schedule','iat':NOW-10,'nbf':NOW-10,'exp':NOW+60}
KEY={'kid':'test-key','kty':'RSA','alg':'RS256','n':fixtures.Priority3Tests.TEST_RSA_N,'e':'AQAB'}
def token(header=None,claims=None):
    encode=lambda x:base64.urlsafe_b64encode(x).rstrip(b'=').decode()
    h=encode(json.dumps({'alg':'RS256','kid':'test-key','typ':'JWT'} if header is None else header).encode())
    c=encode(json.dumps(CLAIMS if claims is None else claims).encode())
    di=oidc.DIGEST_INFO_PREFIX+hashlib.sha256((h+'.'+c).encode()).digest()
    encoded=b'\x00\x01'+b'\xff'*(256-len(di)-3)+b'\x00'+di
    n=int.from_bytes(oidc._decode(KEY['n']),'big');d=int.from_bytes(oidc._decode(fixtures.Priority3Tests.TEST_RSA_D),'big')
    return h+'.'+c+'.'+encode(pow(int.from_bytes(encoded,'big'),d,n).to_bytes(256,'big'))
class Response(io.BytesIO):
    def geturl(self):return oidc.ISSUER+'/.well-known/jwks'

class IntegrityTests(unittest.TestCase):
    def test_calendar_cache_is_server_only_and_never_starts_collection(self):
        from backend.services.forecast_calendar import ensure_forecast_calendar
        with patch.dict('os.environ',{'SUPABASE_SERVICE_ROLE_KEY':'fixture-only','UPSTOX_ANALYTICS_TOKEN':'fixture-only'}),patch('backend.services.forecast_calendar.rpc',return_value={'is_open':True}) as rpc,patch('backend.services.forecast_calendar.Upstox') as provider:
            ensure_forecast_calendar({'id':'u','token':'t'},{'index_id':'i','trading_date':'2026-10-05'})
            rpc.assert_called_once_with('get_forecast_session',{'p_index_id':'i','p_trading_date':'2026-10-05'});provider.assert_not_called()
    def test_missing_calendar_resolves_dated_provider_session_not_price_candles(self):
        from backend.services.forecast_calendar import ensure_forecast_calendar
        with patch.dict('os.environ',{'SUPABASE_SERVICE_ROLE_KEY':'fixture-only','UPSTOX_ANALYTICS_TOKEN':'fixture-only'}),patch('backend.services.forecast_calendar.rpc',side_effect=[None,None]) as rpc,patch('backend.services.forecast_calendar.select',return_value=[{'exchange':'NSE','timezone':'Asia/Kolkata'}]),patch('backend.services.forecast_calendar.Upstox') as provider:
            provider.return_value.session.return_value=fixtures.WINDOW
            ensure_forecast_calendar({'id':'u','token':'t'},{'index_id':'i','trading_date':'2026-10-05'})
            self.assertEqual(rpc.call_args.args[0],'record_forecast_session')
            self.assertEqual(rpc.call_args.args[1]['p_window']['opens_at'],fixtures.START.isoformat())
            provider.return_value.candles.assert_not_called()
    def test_calendar_failure_and_import_do_not_fetch_prices_or_promote_eligibility(self):
        from backend.services.forecast_calendar import ensure_forecast_calendar
        with patch.dict('os.environ',{'SUPABASE_SERVICE_ROLE_KEY':'fixture-only','UPSTOX_ANALYTICS_TOKEN':'fixture-only'}),patch('backend.services.forecast_calendar.rpc',side_effect=DataUnavailable('DATABASE_UNAVAILABLE')) as rpc:
            ensure_forecast_calendar({'id':'u','token':'t'},{'index_id':'i','trading_date':'2026-10-05'})
            self.assertEqual(rpc.call_count,1)
            ensure_forecast_calendar({'id':'u','token':'t'},{'index_id':'i','trading_date':'2026-10-05','submission_kind':'import'})
            self.assertEqual(rpc.call_count,1)
    def test_malformed_jwt_shapes_fail_closed_without_fetch(self):
        for header,claims in [(v,CLAIMS) for v in ([],True,1,'header')]+[({'alg':'RS256','kid':v},CLAIMS) for v in ([],{},True,123)]+[({'alg':'RS256','kid':'test-key'},v) for v in ([],False,1,'payload')]:
            with self.subTest(header=type(header).__name__,claims=type(claims).__name__),patch.object(oidc,'_keys') as keys:
                with self.assertRaises(oidc.InvalidIdentity):oidc.verify_github_token(token(header,claims),NOW)
                keys.assert_not_called()
    def test_invalid_claim_types_lifetime_and_nonfinite_values_fail_closed(self):
        for changes in ({'exp':float('nan')},{'exp':float('inf')},{'exp':'1800000060'}, {'iat':True},
                        {'nbf':{}},{'aud':[{}]},{'exp':NOW+1000},{'iat':NOW+61}, {'nbf':NOW+61}):
            with self.subTest(changes=list(changes)),self.assertRaises(oidc.InvalidIdentity):oidc.verify_github_token(token(claims={**CLAIMS,**changes}),NOW)
    def test_unknown_kid_refreshes_jwks_and_verifies_rotated_key(self):
        old={'keys':[dict(KEY,kid='old-key',n='AQAB')]}
        with patch.multiple(oidc,_jwks=old,_jwks_expiry=NOW+1000,_jwks_last_refresh=NOW-100),patch('urllib.request.urlopen',return_value=Response(json.dumps({'keys':[KEY]}).encode())) as request:
            self.assertTrue(oidc.verify_github_token(token(),NOW));self.assertEqual(request.call_count,1)
            self.assertTrue(oidc.verify_github_token(token(),NOW+1));self.assertEqual(request.call_count,1)
            bad=token(header={'alg':'RS256','kid':'unknown'})
            with self.assertRaises(oidc.InvalidIdentity):oidc.verify_github_token(bad,NOW+2)
            self.assertEqual(request.call_count,1)
    def test_failed_jwks_refresh_never_authenticates_and_is_rate_bounded(self):
        with patch.multiple(oidc,_jwks={'keys':[]},_jwks_expiry=NOW+1000,_jwks_last_refresh=NOW-100),patch('urllib.request.urlopen',side_effect=urllib.error.URLError('network failure')) as request:
            for tick in (NOW,NOW+1):
                with self.assertRaises(oidc.InvalidIdentity):oidc.verify_github_token(token(),tick)
            self.assertEqual(request.call_count,1)
    def test_malformed_jwks_members_cannot_raise_attribute_errors(self):
        with patch.object(oidc,'_keys',return_value={'keys':[None,[],4,{'kid':'test-key','kty':'RSA','n':[], 'e':'AQAB'}]}):
            with self.assertRaises(oidc.InvalidIdentity):oidc.verify_github_token(token(),NOW)
    def test_invalid_identity_cannot_reach_collector(self):
        from backend.market_data.api import run_job
        from backend.errors import ApiError
        with patch.dict('os.environ',{'MARKET_COLLECTION_ENABLED':'true'}),patch('backend.market_data.api.collect') as collector:
            with self.assertRaises(ApiError) as error:run_job({'Authorization':'Bearer '+token(header=[])})
            self.assertEqual(error.exception.status,403);collector.assert_not_called()
    def test_daily_intraday_reconciliation_covers_all_extrema_and_close(self):
        for name in ('high','low','close','open'):
            raw=fixtures.fixture();bars=raw['intraday']['data']['candles']
            if name=='high':
                for row in bars:row[2]=104
            if name=='low':
                for row in bars:row[3]=96
            if name=='close':bars[-1][4]=102
            if name=='open':bars[0][1]=101
            with self.subTest(name=name),self.assertRaises(DataUnavailable) as error:
                normalize(fixtures.JOB,'upstox','instrument',fixtures.DAY,fixtures.WINDOW,raw,fixtures.NOW)
            self.assertTrue(error.exception.code.startswith('INCONSISTENT_'))
    def test_daily_remains_authoritative_inside_tolerance(self):
        raw=fixtures.fixture();raw['intraday']['data']['candles'][-1][4]=101.04
        result=normalize(fixtures.JOB,'upstox','instrument',fixtures.DAY,fixtures.WINDOW,raw,fixtures.NOW)
        self.assertEqual(result['close'],101)
        self.assertEqual(result['methodology']['reconciliation']['policy'],'ohlc-10ppm-0.05-v1')
    def test_reconciliation_tolerance_boundary_matches_decimal_database_policy(self):
        raw=fixtures.fixture();raw['intraday']['data']['candles'][-1][4]=101.05
        self.assertEqual(normalize(fixtures.JOB,'upstox','i',fixtures.DAY,fixtures.WINDOW,raw,fixtures.NOW)['close'],101)
        raw['intraday']['data']['candles'][-1][4]=101.05001
        with self.assertRaises(DataUnavailable):normalize(fixtures.JOB,'upstox','i',fixtures.DAY,fixtures.WINDOW,raw,fixtures.NOW)
    def test_inconsistent_collection_quarantines_and_never_publishes(self):
        from unittest.mock import Mock
        repo=Mock();repo.claim.return_value=[fixtures.JOB]
        source=fixtures.FakeProvider();raw=fixtures.fixture();raw['intraday']['data']['candles'][-1][4]=102
        with patch.object(source,'candles',return_value=raw):out=collect(source,repo,fixtures.NOW)
        self.assertEqual(out[0]['status'],'quarantined');repo.publish.assert_not_called();repo.finish.assert_not_called()
        self.assertEqual(repo.quarantine.call_args.args[2]['raw_market_data'],raw)
    def test_verified_statistics_exclude_historical_and_missing_provenance_but_history_retains_them(self):
        rows=[{'id':'verified','verification_status':'verified','scoring_status':'scored','score':80},
              {'id':'late','verification_status':'late','scoring_status':'scored','score':100},
              {'id':'legacy','scoring_status':'scored','score':100}]
        with patch('backend.services.statistics.select',return_value=rows):
            self.assertEqual(get_my_statistics({'id':'u','token':'t'})['average_score'],80)
            self.assertEqual(len(get_my_score_history({'id':'u','token':'t'})),3)

class WorkflowTests(unittest.TestCase):
    def script(self):
        text=Path('.github/workflows/market-collection.yml').read_text()
        return textwrap.dedent(text.split("python3 - <<'PY'\n",1)[1].rsplit('\n          PY',1)[0])
    def run_script(self,url,opener):
        env={'COLLECTOR_URL':url,'ACTIONS_ID_TOKEN_REQUEST_URL':'https://runner.example/id?x=1','ACTIONS_ID_TOKEN_REQUEST_TOKEN':'fake-runner-only'}
        with patch.dict('os.environ',env),patch('urllib.request.build_opener',return_value=opener),patch('builtins.print'):
            with self.assertRaises(SystemExit) as exit_code:exec(compile(self.script(),'<workflow>','exec'),{})
            return exit_code.exception.code
    def test_destination_host_scheme_path_credentials_query_and_port_are_restricted(self):
        from unittest.mock import Mock
        for url in ['https://evil.example/api/v1/internal/market-collect','http://market-forward-test.onrender.com/api/v1/internal/market-collect',
                    'https://market-forward-test.onrender.com.evil.example/api/v1/internal/market-collect',
                    'https://u:p@market-forward-test.onrender.com/api/v1/internal/market-collect',
                    'https://market-forward-test.onrender.com:8443/api/v1/internal/market-collect',
                    'https://market-forward-test.onrender.com/wrong',
                    'https://market-forward-test.onrender.com/api/v1/internal/market-collect?redirect=evil']:
            opener=Mock();self.assertNotEqual(self.run_script(url,opener),0);opener.open.assert_not_called()
    def test_each_batch_renews_identity_before_posting(self):
        from unittest.mock import Mock
        opener=Mock();identities=[];sent=[]
        def open(request,timeout):
            if request.full_url.startswith('https://runner.example/'):
                identities.append('fake-token-'+str(len(identities)+1));body={'value':identities[-1]}
            else:
                sent.append(request.get_header('Authorization'));body={'results':[{'status':'success'}] if len(sent)==1 else []}
            return io.BytesIO(json.dumps(body).encode())
        opener.open.side_effect=open
        self.assertEqual(self.run_script('https://market-forward-test.onrender.com/api/v1/internal/market-collect',opener),0)
        self.assertEqual(sent,['Bearer fake-token-1','Bearer fake-token-2'])
    def test_redirect_handler_never_follows_another_host(self):
        # Execute only the class definition from the actual workflow.
        import ast,urllib.request
        tree=ast.parse(self.script());definition=next(node for node in tree.body if isinstance(node,ast.ClassDef))
        scope={'urllib':__import__('urllib')};exec(compile(ast.Module(body=[definition],type_ignores=[]),'<workflow>','exec'),scope)
        with self.assertRaises(urllib.error.URLError):scope['NoRedirect']().redirect_request(None,None,None,None,None,None)
