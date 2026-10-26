"""Strict, fail-closed GitHub OIDC with bounded signing-key rotation refresh."""
import base64
import hashlib
import hmac
import json
import math
import re
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
_jwks_last_refresh = float('-inf')
_jwks_lock = threading.Lock()
DIGEST_INFO_PREFIX = bytes.fromhex('3031300d060960864801650304020105000420')

class InvalidIdentity(Exception):
    pass


def _decode(part):
    if not isinstance(part,str) or not re.fullmatch(r'[A-Za-z0-9_-]+',part):
        raise ValueError('Invalid base64url')
    return base64.b64decode(part + '=' * (-len(part) % 4),altchars=b'-_',validate=True)


def _object(pairs):
    result={}
    for key,value in pairs:
        if key in result: raise ValueError('Duplicate JWT field')
        result[key]=value
    return result


def _json(part):
    value=json.loads(_decode(part),object_pairs_hook=_object,
                    parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    if not isinstance(value,dict): raise ValueError('JWT must contain objects')
    return value


def _keys(now, force=False):
    global _jwks, _jwks_expiry, _jwks_last_refresh
    with _jwks_lock:
        if _jwks and now < _jwks_expiry and not force:
            return _jwks
        # At most one network refresh per 30s, including unsuccessful requests.
        if now - _jwks_last_refresh < 30:
            if _jwks and now < _jwks_expiry: return _jwks
            raise InvalidIdentity()
        _jwks_last_refresh=now
        request=urllib.request.Request(ISSUER+'/.well-known/jwks',headers={'Accept':'application/json'})
        try:
            with urllib.request.urlopen(request,timeout=5) as response:
                # Redirected key material is not an approved trust root.
                if response.geturl() != ISSUER+'/.well-known/jwks': raise InvalidIdentity()
                raw=response.read(262145)
            if len(raw)>262144: raise InvalidIdentity()
            value=json.loads(raw)
            if not isinstance(value,dict) or not isinstance(value.get('keys'),list) or len(value['keys'])>100:
                raise InvalidIdentity()
            _jwks,_jwks_expiry=value,now+3600
            return _jwks
        except (urllib.error.URLError,TimeoutError,OSError,ValueError,RecursionError):
            raise InvalidIdentity() from None


def _find_key(keys, kid):
    if not isinstance(keys,dict) or not isinstance(keys.get('keys'),list): raise InvalidIdentity()
    matches=[k for k in keys['keys'] if isinstance(k,dict) and k.get('kid')==kid
             and k.get('kty')=='RSA' and k.get('alg') in ('RS256',None) and k.get('use') in ('sig',None)]
    if len(matches)>1: raise InvalidIdentity()
    return matches[0] if matches else None


def verify_github_token(token, now=None):
    now=time.time() if now is None else now
    try:
        if not isinstance(token,str) or len(token)>16384: raise ValueError
        header_part,claims_part,signature_part=token.split('.')
        header,claims=_json(header_part),_json(claims_part)
        if (header.get('alg')!='RS256' or not isinstance(header.get('kid'),str)
            or not 1<=len(header['kid'])<=256 or header.get('typ') not in ('JWT',None)
            or 'crit' in header): raise ValueError
        for name in ('exp','iat','nbf'):
            value=claims.get(name)
            if type(value) not in (int,float) or not math.isfinite(value): raise ValueError
        if (claims['exp']<=now or claims['nbf']>now+60 or claims['iat']>now+60
            or claims['iat']>claims['exp'] or claims['nbf']>claims['exp']
            or not 0<claims['exp']-claims['iat']<=600): raise ValueError
        audiences=claims.get('aud')
        if audiences!=AUDIENCE and audiences!=[AUDIENCE]: raise ValueError
        if (claims.get('iss')!=ISSUER or claims.get('repository')!=REPOSITORY
            or claims.get('repository_owner')!='VASU4470' or claims.get('workflow_ref')!=WORKFLOW
            or claims.get('ref')!='refs/heads/main' or claims.get('event_name') not in ('schedule','workflow_dispatch')):
            raise ValueError
        key=_find_key(_keys(now),header['kid'])
        if key is None: key=_find_key(_keys(now,force=True),header['kid'])
        if key is None: raise ValueError
        modulus,exponent=int.from_bytes(_decode(key['n']),'big'),int.from_bytes(_decode(key['e']),'big')
        signature_bytes=_decode(signature_part)
        signature=int.from_bytes(signature_bytes,'big')
        if (not 2048<=modulus.bit_length()<=8192 or not 3<=exponent<=2**32-1 or exponent%2==0
            or len(signature_bytes)!=(modulus.bit_length()+7)//8 or signature>=modulus): raise ValueError
        encoded=pow(signature,exponent,modulus).to_bytes((modulus.bit_length()+7)//8,'big')
        digest_info=DIGEST_INFO_PREFIX+hashlib.sha256((header_part+'.'+claims_part).encode()).digest()
        padding=len(encoded)-len(digest_info)-3
        if padding<8 or not hmac.compare_digest(encoded,b'\x00\x01'+b'\xff'*padding+b'\x00'+digest_info): raise ValueError
        return True
    except (ValueError,TypeError,KeyError,OverflowError,UnicodeError,RecursionError):
        raise InvalidIdentity() from None
