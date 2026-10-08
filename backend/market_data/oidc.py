"""Verify short-lived GitHub Actions OIDC identity tokens without shared secrets."""
import base64
import hashlib
import hmac
import json
import threading
import time
import urllib.error
import urllib.request

ISSUER = 'https://token.actions.githubusercontent.com'
AUDIENCE = 'market-forward-test-collector'
REPOSITORY = 'VASU4470/Market-Forward-Test'
WORKFLOW = REPOSITORY + '/.github/workflows/market-collection.yml@refs/heads/main'
_jwks = None
_jwks_expiry = 0.0
_jwks_lock = threading.Lock()
DIGEST_INFO_PREFIX = bytes.fromhex('3031300d060960864801650304020105000420')


class InvalidIdentity(Exception):
    pass


def _decode(part):
    return base64.urlsafe_b64decode(part + '=' * (-len(part) % 4))


def _keys(now):
    global _jwks, _jwks_expiry
    with _jwks_lock:
        if _jwks and now < _jwks_expiry:
            return _jwks
        request = urllib.request.Request(ISSUER + '/.well-known/jwks', headers={'Accept':'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                value = json.load(response)
            if not isinstance(value, dict) or not isinstance(value.get('keys'), list):
                raise InvalidIdentity()
            _jwks, _jwks_expiry = value, now + 3600
            return _jwks
        except (urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError):
            raise InvalidIdentity()


def verify_github_token(token, now=None):
    now = time.time() if now is None else now
    try:
        if not isinstance(token, str) or len(token) > 16384:
            raise ValueError
        header_part, claims_part, signature_part = token.split('.')
        header = json.loads(_decode(header_part))
        claims = json.loads(_decode(claims_part))
        if header.get('alg') != 'RS256' or not header.get('kid') or header.get('typ') not in ('JWT', None):
            raise ValueError
        key = next(k for k in _keys(now)['keys'] if k.get('kid') == header['kid'] and k.get('kty') == 'RSA' and k.get('alg') in ('RS256', None))
        modulus, exponent = int.from_bytes(_decode(key['n']), 'big'), int.from_bytes(_decode(key['e']), 'big')
        signature = int.from_bytes(_decode(signature_part), 'big')
        if modulus.bit_length() < 2048 or signature >= modulus:
            raise ValueError
        encoded = pow(signature, exponent, modulus).to_bytes((modulus.bit_length()+7)//8, 'big')
        digest_info = DIGEST_INFO_PREFIX + hashlib.sha256((header_part+'.'+claims_part).encode()).digest()
        padding = len(encoded) - len(digest_info) - 3
        expected = b'\x00\x01' + b'\xff'*padding + b'\x00' + digest_info
        if padding < 8 or not hmac.compare_digest(encoded, expected):
            raise ValueError
        audiences = claims.get('aud')
        if isinstance(audiences, str):
            audiences = [audiences]
        if (not isinstance(audiences, list) or set(audiences) != {AUDIENCE}
            or claims.get('iss') != ISSUER or claims.get('repository') != REPOSITORY
            or claims.get('repository_owner') != 'VASU4470'
            or claims.get('workflow_ref') != WORKFLOW or claims.get('ref') != 'refs/heads/main'
            or claims.get('event_name') not in ('schedule', 'workflow_dispatch')
            or float(claims['exp']) <= now or float(claims.get('nbf', 0)) > now + 60
            or float(claims.get('iat', 0)) > now + 60):
            raise ValueError
        return True
    except (ValueError, TypeError, KeyError, StopIteration, OverflowError, json.JSONDecodeError, UnicodeError):
        raise InvalidIdentity()
