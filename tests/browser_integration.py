"""Real served-page integration with local-only API fixtures; no live accounts/data."""
import copy
from datetime import datetime
from datetime import timedelta
from http.server import ThreadingHTTPServer
import json
import os
import re
from pathlib import Path
import threading
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright
from server import Handler

USER='00000000-0000-0000-0000-000000000001'
EMAIL='tester@example.test'
INDEX='00000000-0000-0000-0000-000000000010'
TODAY=datetime.now(ZoneInfo('Asia/Kolkata')).date().isoformat()
class QuietHandler(Handler):
    def log_message(self,*args):pass

class BrowserRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.env=patch.dict(os.environ,{'SUPABASE_URL':'https://fixture.invalid','SUPABASE_PUBLISHABLE_KEY':'fixture-public',
            'MARKET_COLLECTION_ENABLED':'false','UPSTOX_ANALYTICS_TOKEN':'','UPSTOX_ACCESS_TOKEN':''})
        cls.env.start()
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),QuietHandler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.base='http://127.0.0.1:'+str(cls.server.server_port)
        cls.play=sync_playwright().start();cls.browser=cls.play.chromium.launch(executable_path=os.getenv('MFT_TEST_CHROMIUM','/usr/bin/chromium'),headless=True)
    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.play.stop();cls.server.shutdown();cls.server.server_close();cls.thread.join();cls.env.stop()
    def fixture_prediction(self,**changes):
        return {'date':'2026-10-05','indexId':INDEX,'bias':'Bullish','opening':'Flat','dayType':'Range','support':95,'resistance':105,
                'lockedAt':'2026-10-05T02:00:00Z','actual':{'bias':'Bullish','opening':'Flat','dayType':'Range','low':95,'high':105},
                'score':{'total':73,'detail':{'bias':25,'opening':20,'dayType':20,'support':4,'resistance':4}},**changes}
    def open_app(self,predictions=None,periods=None,failure=None,local=False):
        self.local_fixture=local
        self.failure=failure;self.close_failure=False;self.server_predictions=[];self.server_periods=[];self.requests=[];self.errors=[]
        profile={'name':'Test','email':EMAIL,'supabaseUserId':USER,'state':{'language':'en','predictions':predictions or [],'forwardTests':periods or []}}
        store={'activeProfile':EMAIL,'profiles':{EMAIL:profile}}
        for period in periods or []:
            if period.get('cloudId'):
                self.server_periods.append({'id':period['cloudId'],'client_key':period['id'],'status':period['status'],
                    'start_date':period['startDate'],'duration_sessions':period['targetSessions'],'created_at':period['startedAt']})
        context=self.browser.new_context(service_workers='block');self.addCleanup(context.close)
        if local:
            context.add_init_script("Object.defineProperty(window.crypto,'randomUUID',{value:undefined,configurable:true});")
        context.add_init_script('''const seed=SEED;
          if (!localStorage.getItem('marketForwardTestV2')) localStorage.setItem('marketForwardTestV2',JSON.stringify(seed));
          localStorage.setItem('mftCloudMigrationV1:USER','complete');
          const fakeUser={id:'USER',email:'EMAIL',user_metadata:{mft_account_complete:true,display_name:'Test',username:'testuser',preferred_language:'en'}};
          window.supabase={createClient:()=>({auth:{getSession:async()=>({data:{session:{user:fakeUser,access_token:'local-fixture-only'}}}),signOut:async()=>({error:null})}})};
        '''.replace('SEED',json.dumps(store)).replace('USER',USER).replace('EMAIL',EMAIL))
        context.route('**/*',self.route)
        page=context.new_page();page.on('pageerror',lambda e:self.errors.append(e.stack));page.goto(self.base)
        page.wait_for_function("!document.getElementById('appShell').classList.contains('hidden')" if local else "document.body.classList.contains('supabase-live') && !document.getElementById('appShell').classList.contains('hidden')")
        page.wait_for_timeout(150)
        self.page=page;return page
    def route(self,route):
        request=route.request;url=request.url
        if not url.startswith(self.base+'/'):
            route.abort();return
        path=url[len(self.base):].split('?')[0]
        if self.local_fixture and path in ('/','/index.html'):
            response=route.fetch()
            body=re.sub(r'window.MFT_AUTH_CONFIG=.*?;</script>','window.MFT_AUTH_CONFIG={};</script>',response.text())
            route.fulfill(response=response,body=body);return
        if not path.startswith('/api/'):
            route.continue_();return
        body=request.post_data_json if request.post_data else {}
        self.requests.append((request.method,path,body))
        status=200
        if path=='/api/v1/indices':payload={'indices':[{'id':INDEX,'code':'NIFTY50','display_name':'NIFTY 50','exchange':'NSE','timezone':'Asia/Kolkata'}]}
        elif path=='/api/v1/predictions' and request.method=='POST':
            if self.failure=='abort':route.abort();return
            if self.failure:status=self.failure;payload={'error':'FIXTURE_FAILURE'}
            else:
                row={**body,'user_id':USER,'id':'prediction-'+str(len(self.server_predictions)+1),'verification_status':'historical' if body.get('submission_kind')=='import' else 'verified','locked_at':datetime.now().astimezone().isoformat(),'scoring_status':'pending','test_period_id':body.get('test_period_id')}
                self.server_predictions.append(row);payload={'prediction':row}
        elif path=='/api/v1/predictions/me':payload={'predictions':self.server_predictions}
        elif path=='/api/v1/test-periods' and request.method=='POST':
            row={**body,'id':'period-'+body['client_key'],'created_at':datetime.now().astimezone().isoformat()};self.server_periods.append(row);payload={'test_period':row}
        elif path=='/api/v1/test-periods':payload={'test_periods':self.server_periods}
        elif path.startswith('/api/v1/test-periods/') and request.method=='PATCH':
            if self.close_failure:status=503;payload={'error':'FIXTURE_CLOSURE_UNAVAILABLE'}
            else:
                row=next(r for r in self.server_periods if r['id']==path.split('/')[-1]);row.update(body);payload={'test_period':row}
        elif path=='/api/v1/statistics':payload={'statistics':{}}
        elif path=='/api/v1/test-progress':payload={}
        elif path=='/api/v1/ranking':payload={'ranking':[]}
        else:payload={'error':'FIXTURE_NO_DATA'};status=503
        route.fulfill(status=status,content_type='application/json',body=json.dumps(payload))
    def state(self):return self.page.evaluate("JSON.parse(localStorage.getItem('marketForwardTestV2')).profiles["+json.dumps(EMAIL)+"].state")
    def test_failed_migration_empty_get_and_reload_never_lose_scores_then_online_reconciles(self):
        page=self.open_app([self.fixture_prediction()],failure=400)
        page.wait_for_function("JSON.parse(localStorage.getItem('marketForwardTestV2')).profiles['"+EMAIL+"'].state.predictions[0].cloudSync==='pending'")
        self.assertEqual(self.state()['predictions'][0]['score']['total'],73)
        page.reload();page.wait_for_timeout(300)
        self.assertEqual(len(self.state()['predictions']),1)
        self.assertEqual(self.state()['predictions'][0]['support'],95)
        self.failure=None;page.evaluate("window.dispatchEvent(new Event('online'))")
        page.wait_for_function("JSON.parse(localStorage.getItem('marketForwardTestV2')).profiles['"+EMAIL+"'].state.predictions[0].cloudSync==='synced'")
        self.assertEqual(self.state()['predictions'][0]['score']['total'],73)
        self.assertEqual(self.server_predictions[0]['submission_kind'],'import')
        self.assertEqual(self.server_predictions[0]['import_metadata']['original_score']['total'],73)
        self.assertFalse(self.errors,self.errors)
    def test_actual_lock_override_associates_and_advances_the_selected_one_session_period(self):
        page=self.open_app();page.locator('#forwardTestTarget').fill('1');page.locator('#forwardTestForm button').click()
        page.wait_for_function("JSON.parse(localStorage.getItem('marketForwardTestV2')).profiles['"+EMAIL+"'].state.forwardTests[0].cloudId")
        for group,value in [('bias','Bullish'),('opening','Flat'),('dayType','Range')]:page.locator(f'[data-group="{group}"] [data-value="{value}"]').click()
        page.locator('#support').fill('95');page.locator('#resistance').fill('105');page.locator('#lockBtn').click();page.locator('#confirmLock').click()
        page.wait_for_function("JSON.parse(localStorage.getItem('marketForwardTestV2')).profiles['"+EMAIL+"'].state.predictions[0]?.cloudSync==='synced'")
        state=self.state();p=state['predictions'][0];period=state['forwardTests'][0]
        self.assertEqual(period['targetSessions'],1);self.assertEqual(period['status'],'completed');self.assertEqual(p['testPeriodId'],period['id'])
        self.assertEqual(self.server_predictions[0]['test_period_id'],period['cloudId']);self.assertEqual(self.server_predictions[0]['submission_kind'],'live')
        self.assertFalse(self.errors,self.errors)
    def test_failed_closure_blocks_replacement_then_recovers_365_session_choice(self):
        old={'id':'old','cloudId':'server-old','cloudSync':'synced','cloudStatus':'active','status':'active','startDate':TODAY,'targetSessions':365,'startedAt':TODAY+'T00:00:00+05:30'}
        page=self.open_app(periods=[old]);self.close_failure=True
        page.on('dialog',lambda d:d.accept());page.locator('#newForwardTest').click();page.locator('#forwardTestTarget').fill('365');page.locator('#forwardTestForm button').click()
        page.wait_for_function("JSON.parse(localStorage.getItem('marketForwardTestV2')).profiles['"+EMAIL+"'].state.forwardTests.length===2")
        page.wait_for_timeout(100)
        self.assertFalse([r for r in self.requests if r[0]=='POST' and r[1]=='/api/v1/test-periods'])
        self.close_failure=False;page.evaluate("window.dispatchEvent(new Event('online'))")
        page.wait_for_function("JSON.parse(localStorage.getItem('marketForwardTestV2')).profiles['"+EMAIL+"'].state.forwardTests[1].cloudId")
        self.assertEqual(self.state()['forwardTests'][1]['targetSessions'],365);self.assertEqual(self.server_periods[0]['status'],'stopped')
        self.assertFalse(self.errors,self.errors)
    def test_connection_loss_and_display_deduplication_preserve_both_unuploaded_variants(self):
        page=self.open_app([self.fixture_prediction(),self.fixture_prediction(support=96,score={'total':81,'detail':{}})],failure='abort')
        page.wait_for_timeout(200);self.assertEqual(len(self.state()['predictions']),2)
        page.reload();page.wait_for_timeout(300);self.assertEqual(sorted(p['score']['total'] for p in self.state()['predictions']),[73,81])
        self.assertFalse(self.errors,self.errors)
    def test_local_manual_scoring_and_duration_controls_remain_available_without_cloud(self):
        page=self.open_app(local=True)
        self.assertEqual(page.locator('#forwardTestTarget').get_attribute('min'),'1')
        self.assertEqual(page.locator('#forwardTestTarget').get_attribute('max'),'365')
        for group,value in [('bias','Bullish'),('opening','Flat'),('dayType','Range')]:page.locator(f'[data-group="{group}"] [data-value="{value}"]').click()
        page.locator('#support').fill('95');page.locator('#resistance').fill('105');page.locator('#lockBtn').click();page.locator('#confirmLock').click()
        page.locator('.nav-item[data-target="result"]').first.click()
        page.locator('#actualForm').wait_for(state='visible')
        for field,value in [('actualBias','Bullish'),('actualOpening','Flat'),('actualDayType','Range')]:page.locator('#'+field).select_option(value)
        page.locator('#actualLow').fill('95');page.locator('#actualHigh').fill('105');page.locator('#actualForm button[type="submit"]').click()
        self.assertEqual(self.state()['predictions'][0]['score']['total'],100)
        self.assertFalse([r for r in self.requests if r[0]=='POST' and r[1]=='/api/v1/predictions'])
        self.assertFalse(self.errors,self.errors)
    def test_future_365_session_period_stays_scheduled_and_does_not_claim_todays_forecast(self):
        page=self.open_app()
        future=(datetime.now(ZoneInfo('Asia/Kolkata'))+timedelta(days=2)).date().isoformat()
        page.locator('#forwardTestStart').fill(future);page.locator('#forwardTestTarget').fill('365');page.locator('#forwardTestForm button').click()
        page.wait_for_function("JSON.parse(localStorage.getItem('marketForwardTestV2')).profiles['"+EMAIL+"'].state.forwardTests[0].cloudSync==='synced'")
        period=self.state()['forwardTests'][0]
        self.assertEqual(period['status'],'scheduled');self.assertEqual(period['cloudStatus'],'scheduled');self.assertEqual(period['targetSessions'],365)
        for group,value in [('bias','Bullish'),('opening','Flat'),('dayType','Range')]:page.locator(f'[data-group="{group}"] [data-value="{value}"]').click()
        page.locator('#support').fill('95');page.locator('#resistance').fill('105');page.locator('#lockBtn').click();page.locator('#confirmLock').click()
        page.wait_for_function("JSON.parse(localStorage.getItem('marketForwardTestV2')).profiles['"+EMAIL+"'].state.predictions[0]?.cloudSync==='synced'")
        self.assertIsNone(self.state()['predictions'][0]['testPeriodId']);self.assertIsNone(self.server_predictions[0]['test_period_id'])
        self.assertFalse(self.errors,self.errors)

if __name__=='__main__':unittest.main()
