import unittest
from unittest.mock import patch
from pathlib import Path

from backend.services.account import delete_account, validate_delete_confirmation
from backend.services.predictions import create_prediction
from backend.services.ranking import get_ranking, sanitize_ranking_rows
from backend.services.scoring import calculate_score, score_prediction
from backend.services.statistics import get_my_statistics
from backend.services.statistics import get_my_score_history
from backend.services.test_periods import create_test_period
from backend.errors import ApiError
from backend.routes.api import dispatch


class Priority2Tests(unittest.TestCase):
    def test_protected_api_rejects_missing_authorization(self):
        handler = type("Handler", (), {"headers": {}, "path": "/api/v1/statistics"})()
        with self.assertRaises(ApiError) as caught:
            dispatch(handler, "GET", "/api/v1/statistics")
        self.assertEqual(caught.exception.code, "AUTH_REQUIRED")

    def test_prediction_user_id_is_derived_from_authenticated_user(self):
        user = {"id": "user-a", "token": "token-a"}
        payload = {
            "user_id": "user-b",
            "index_id": "index-1",
            "trading_date": "2026-10-01",
            "bias": "Bullish",
            "opening_view": "Flat",
            "day_type": "Range",
            "support": 100,
            "resistance": 200,
        }
        with patch("backend.services.predictions.insert", return_value=[{"id": "p1", "user_id": "user-a"}]) as insert:
            create_prediction(user, payload)
        sent = insert.call_args.args[2]
        self.assertEqual(sent["user_id"], "user-a")
        self.assertNotIn("score", sent)
        self.assertNotIn("scoring_status", sent)

    def test_score_calculation_matches_existing_rule(self):
        prediction = {"bias": "Bullish", "opening_view": "Flat", "day_type": "Range", "support": 100, "resistance": 200}
        actual = {"actual_bias": "Bullish", "actual_opening": "Flat", "actual_day_type": "Range", "low": 100, "high": 200}
        result = calculate_score(prediction, actual)
        self.assertEqual(result["total"], 100)
        self.assertEqual(result["rule_version"], "p2-v1")

    def test_scoring_delegates_to_protected_atomic_rpc(self):
        user = {"id": "user-a", "token": "token-a"}
        scored = {"id": "p1", "scoring_status": "scored", "score": 100, "scoring_rule_version": "p2-v1"}
        with patch("backend.services.scoring.rpc", return_value=scored) as rpc:
            first = score_prediction(user, "p1")
            second = score_prediction(user, "p1")
        self.assertEqual(first, second)
        rpc.assert_any_call("score_prediction", user["token"], {"p_prediction_id": "p1"})

    def test_ranking_exposes_only_public_opted_in_fields(self):
        rows = [{
            "username": "alpha",
            "average_score": 91,
            "accuracy_percentage": 80,
            "completed_predictions": 10,
            "email": "private@example.com",
            "phone": "+1 555",
            "id": "private-id",
        }]
        self.assertEqual(sanitize_ranking_rows(rows), [{
            "username": "alpha",
            "average_score": 91,
            "accuracy_percentage": 80,
            "completed_predictions": 10,
        }])

    def test_ranking_uses_authenticated_token(self):
        with patch("backend.services.ranking.rpc", return_value=[]) as rpc:
            get_ranking({"id": "user-a", "token": "token-a"})
        rpc.assert_called_once_with("get_public_ranking", "token-a", {})

    def test_statistics_query_is_scoped_to_authenticated_user(self):
        user = {"id": "user-a", "token": "token-a"}
        with patch("backend.services.statistics.select", return_value=[]) as select:
            get_my_statistics(user)
        for call in select.call_args_list:
            self.assertEqual(call.args[1], "token-a")
            self.assertIn("eq.user-a", str(call.args[2]))

    def test_delete_requires_explicit_confirmation(self):
        self.assertTrue(validate_delete_confirmation({"confirmation": "DELETE MY ACCOUNT"}))
        self.assertFalse(validate_delete_confirmation({"confirmation": "delete"}))
        self.assertFalse(validate_delete_confirmation({}))

    def test_migration_contains_database_lock_and_idempotency_guards(self):
        sql = Path(__file__).parents[1].joinpath("supabase_phase2_schema.sql").read_text()
        for fragment in (
            "create table if not exists public.test_periods",
            "references auth.users(id) on delete cascade",
            "duration_sessions integer not null",
            "between 1 and 365",
            "prevent_prediction_mutation",
            "create or replace function public.score_prediction",
            "if p.scoring_status = 'scored' then",
            "where id = p.id and scoring_status = 'pending'",
            "revoke insert (score, score_details, scoring_status, scored_at, scoring_rule_version)",
            "create or replace function public.get_public_ranking",
            "where p.ranking_opt_in = true",
        ):
            self.assertIn(fragment, sql)

    def test_service_role_reference_is_limited_to_account_deletion(self):
        backend_root = Path(__file__).parents[1].joinpath("backend")
        for path in backend_root.rglob("*.py"):
            text = path.read_text()
            if path.name == "account.py":
                continue
            self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", text, str(path))

    def test_score_history_is_scoped_to_authenticated_user(self):
        user = {"id": "user-a", "token": "token-a"}
        with patch("backend.services.statistics.select", return_value=[]) as select:
            get_my_score_history(user)
        self.assertTrue(select.called)
        self.assertIn("eq.user-a", str(select.call_args.args[2]))

    @patch.dict("os.environ", {
        "SUPABASE_URL": "https://project.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "server-only-key",
    }, clear=False)
    @patch("backend.services.account.urllib.request.urlopen")
    def test_account_deletion_uses_service_role_only_after_confirmation(self, urlopen):
        response = urlopen.return_value.__enter__.return_value
        result = delete_account({"id": "user-a"}, {"confirmation": "DELETE MY ACCOUNT"})
        self.assertEqual(result, {"deleted": True})
        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_header("Authorization"), "Bearer server-only-key")
        self.assertNotIn("server-only-key", request.full_url)

    def test_two_user_queries_cannot_be_cross_scoped(self):
        with patch("backend.services.statistics.select", return_value=[]) as select:
            get_my_statistics({"id": "user-a", "token": "token-a"})
            get_my_statistics({"id": "user-b", "token": "token-b"})
        user_filters = [str(call.args[2]) for call in select.call_args_list]
        self.assertIn("eq.user-a", user_filters[0])
        self.assertIn("eq.user-b", user_filters[1])
        self.assertNotIn("eq.user-b", user_filters[0])
        self.assertNotIn("eq.user-a", user_filters[1])

    def test_test_period_duration_preserves_user_controlled_range(self):
        user = {"id": "user-a", "token": "token-a"}
        with patch("backend.services.test_periods.insert", return_value=[{"duration_sessions": 1}]) as insert:
            create_test_period(user, {"start_date": "2026-10-01", "duration_sessions": 1})
        self.assertEqual(insert.call_args.args[2]["duration_sessions"], 1)
        with patch("backend.services.test_periods.insert", return_value=[{"duration_sessions": 365}]) as insert:
            create_test_period(user, {"start_date": "2026-10-01", "duration_sessions": 365})
        self.assertEqual(insert.call_args.args[2]["duration_sessions"], 365)


if __name__ == "__main__":
    unittest.main()
