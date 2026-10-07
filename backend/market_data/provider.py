"""Read-only provider contract. No account or trading operations belong here."""
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


class DataUnavailable(Exception):
    def __init__(self, code, retry_after=3600):
        super().__init__(code)
        self.code = code
        self.retry_after = retry_after


@dataclass(frozen=True)
class SessionWindow:
    opens_at: datetime
    closes_at: datetime
    audit: dict


class MarketProvider(Protocol):
    name: str

    def session(self, exchange, trading_date) -> SessionWindow: ...

    def candles(self, instrument, trading_date, now) -> dict: ...


def provider():
    import os
    from .upstox import Upstox
    if os.getenv('MARKET_DATA_PROVIDER', 'upstox') != 'upstox':
        raise DataUnavailable('UNSUPPORTED_PROVIDER', 86400)
    return Upstox()
