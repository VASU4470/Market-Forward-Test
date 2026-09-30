import os


def supabase_url():
    return os.getenv("SUPABASE_URL", "").strip().rstrip("/")


def supabase_publishable_key():
    return (os.getenv("SUPABASE_PUBLISHABLE_KEY") or os.getenv("SUPABASE_ANON_KEY") or "").strip()


def is_configured():
    return bool(supabase_url() and supabase_publishable_key())
