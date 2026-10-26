"""Resolve dated deadlines without starting the price collector or using client times."""
from datetime import date
from ..data.supabase_rest import select
from ..errors import ApiError
from ..market_data.provider import DataUnavailable
from ..market_data.repository import rpc, calendar_configured
from ..market_data.upstox import Upstox


def ensure_forecast_calendar(user, payload):
    if payload.get('submission_kind') == 'import':
        return
    if not calendar_configured():
        return  # Retain the forecast, but never infer verification from weekdays.
    try:
        day = date.fromisoformat(payload['trading_date'])
        identity = {'p_index_id':payload['index_id'], 'p_trading_date':day.isoformat()}
        if rpc('get_forecast_session', identity):
            return
        indices = select('indices',user['token'],{'select':'id,exchange,timezone',
            'id':'eq.'+payload['index_id'],'is_active':'eq.true','limit':'1'})
        if not indices:
            return
        try:
            window=Upstox().session(indices[0]['exchange'],day)
            session={'is_open':True,'opens_at':window.opens_at.isoformat(),'closes_at':window.closes_at.isoformat()}
        except DataUnavailable as error:
            if error.code!='NON_TRADING_DAY':
                raise
            session={'is_open':False,'opens_at':None,'closes_at':None}
        rpc('record_forecast_session',{**identity,'p_window':session})
    except (DataUnavailable,ApiError,ValueError,KeyError,TypeError):
        # Database trigger remains authoritative; calendar outages cannot promote
        # a forecast or destroy an offline/manual prediction.
        return
