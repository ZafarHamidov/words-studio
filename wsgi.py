"""Hosted startup and password protection. Edit for production serving behavior."""
import hmac
import os
from werkzeug.wrappers import Request, Response
from app import app, bootstrap_app

password = os.environ.get('ADMIN_PASSWORD', '')
if len(password) < 12:
    raise RuntimeError('Set ADMIN_PASSWORD to at least 12 characters in the TLF PaaS Secrets page')
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024
bootstrap_app()


def application(environ, start_response):
    request = Request(environ)
    if request.path != '/api/health':
        credentials = request.authorization
        if not (credentials and credentials.type == 'basic'
                and hmac.compare_digest((credentials.username or '').encode(), b'admin')
                and hmac.compare_digest((credentials.password or '').encode(), password.encode())):
            response = Response('Sign in to Words Studio', 401, headers={
                'WWW-Authenticate': 'Basic realm="Words Studio", charset="UTF-8"',
                'Cache-Control': 'no-store',
            })
            return response(environ, start_response)
    return app(environ, start_response)
