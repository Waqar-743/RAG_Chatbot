"""
Vercel Serverless Entry Point.

Vercel's Python runtime (`@vercel/python`) serves ASGI apps via Mangum,
an ASGI-to-Lambda/serverless adapter. It discovers the `app` object from
this module (api/index.py) automatically.

How it works:
  1. Vercel receives an HTTP request.
  2. It calls the Mangum handler, which translates the request into ASGI scope.
  3. FastAPI processes the request and returns the response.
"""

import sys
import os

# Make sure the project root is on sys.path so all absolute imports work:
# e.g., `from config.settings import settings`, `from rag.indexing import ...`
_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _root not in sys.path:
    sys.path.insert(0, _root)

from main import app  # noqa: E402

# Vercel discovers and uses `app` directly as an ASGI application.
# No handler wrapper needed — @vercel/python handles ASGI natively.

__all__ = ["app"]
