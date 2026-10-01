from ..data.supabase_rest import rpc


PUBLIC_FIELDS = ("username", "average_score", "accuracy_percentage", "completed_predictions")


def sanitize_ranking_rows(rows):
    return [{field: row.get(field) for field in PUBLIC_FIELDS} for row in (rows or [])]


def get_ranking(user):
    return sanitize_ranking_rows(rpc("get_public_ranking", user["token"], {}))
