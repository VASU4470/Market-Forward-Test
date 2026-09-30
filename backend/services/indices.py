from ..data.supabase_rest import select


def get_indices():
    return select("indices", None, {"select": "*", "is_active": "eq.true", "order": "sort_order.asc,display_name.asc"})
