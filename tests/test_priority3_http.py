"""Exercise the real HTTP handler without production credentials or data."""
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from server import Handler


class QuietHandler(Handler):
    def log_message(self, *args):
        pass


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = 'http://127.0.0.1:' + str(cls.server.server_port)

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, path, method='GET', headers=None):
        request = urllib.request.Request(self.base + path, method=method, headers=headers or {})
        try:
            response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, response.headers, response.read().decode()

    @patch.dict(os.environ, {'UPSTOX_ANALYTICS_TOKEN':'private-provider',
        'SUPABASE_SERVICE_ROLE_KEY':'private-service', 'MARKET_COLLECTOR_TOKEN':'private-job',
        'SUPABASE_PUBLISHABLE_KEY':'public-key','SUPABASE_URL':'https://example.supabase.co'})
    def test_home_and_assets_work_and_do_not_expose_credentials(self):
        status, _, html = self.request('/')
        self.assertEqual(status, 200)
        self.assertIn('public-key', html)
        for secret in ('private-provider', 'private-service', 'private-job'):
            self.assertNotIn(secret, html)
        self.assertIn('auto-score.js?v=5', html)
        for path in ('/auto-score.js', '/services/api-client.js', '/pizero-logo.png'):
            if path.endswith('.png'):
                with urllib.request.urlopen(self.base + path) as response:
                    self.assertEqual(response.status, 200)
                    self.assertTrue(response.read().startswith(b'\x89PNG'))
            else:
                self.assertEqual(self.request(path)[0], 200)

    def test_source_secret_files_and_directory_listing_are_not_served(self):
        for path in ('/.env','/.git/config','/server.py','/supabase_phase3_schema.sql',
                     '/backend/','/tests/database.mjs','/services/','/../server.py'):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0],404)

    @patch.dict(os.environ, {'MARKET_COLLECTION_ENABLED':'true','MARKET_COLLECTOR_TOKEN':'x'*40})
    def test_active_result_and_admin_routes_require_auth(self):
        for path in ('/api/market-result?date=2026-10-05&index=NIFTY50',
                     '/api/v1/market-result?date=2026-10-05', '/api/v1/admin/market-jobs'):
            status, headers, body = self.request(path)
            self.assertEqual(status,401)
            self.assertEqual(headers['Cache-Control'],'no-store')
            self.assertEqual(json.loads(body)['error'],'AUTH_REQUIRED')
        self.assertEqual(self.request('/api/v1/internal/market-collect','POST')[0],403)

    @patch.dict(os.environ, {'MARKET_COLLECTION_ENABLED':'false'})
    def test_disabled_rollout_preserves_pilot_and_blocks_collection(self):
        with patch('server.market_result',return_value=(200,{'status':'pilot'})) as pilot:
            self.assertEqual(self.request('/api/market-result?date=2026-10-05')[0],200)
            pilot.assert_called_once_with('2026-10-05')
        self.assertEqual(self.request('/api/v1/internal/market-collect','POST')[0],503)


if __name__ == '__main__':
    unittest.main()
