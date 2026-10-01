from ..data.supabase_rest import select


def _user_predictions(user):
    return select("predictions", user["token"], {
        "select": "id,scoring_status,score,scored_at,trading_date,test_period_id",
        "user_id": f"eq.{user['id']}",
        "order": "trading_date.desc",
    })


def _user_periods(user):
    return select("test_periods", user["token"], {
        "select": "id,start_date,duration_sessions,end_date,status,created_at,completed_at",
        "user_id": f"eq.{user['id']}",
        "order": "created_at.desc",
    })


def get_my_statistics(user):
    predictions = _user_predictions(user)
    scored = [row for row in predictions if row.get("scoring_status") == "scored" and row.get("score") is not None]
    correct = [row for row in scored if float(row.get("score", 0)) >= 60]
    average = round(sum(float(row["score"]) for row in scored) / len(scored), 2) if scored else None
    return {
        "total_predictions": len(predictions),
        "completed_predictions": len(scored),
        "correct_predictions": len(correct),
        "accuracy_percentage": round(len(correct) * 100 / len(scored), 2) if scored else None,
        "average_score": average,
    }


def get_my_score_history(user):
    return [row for row in _user_predictions(user) if row.get("scoring_status") == "scored"]


def get_my_test_progress(user):
    periods = _user_periods(user)
    predictions = _user_predictions(user)
    active = next((period for period in periods if period.get("status") in ("scheduled", "active")), None)
    completed = [period for period in periods if period.get("status") == "completed"]
    if active:
        dates = {
            row.get("trading_date") for row in predictions
            if row.get("test_period_id") == active.get("id")
        }
        active = {**active, "completed_sessions": len({date for date in dates if date})}
    return {"active_test_period": active, "completed_test_periods": completed}
