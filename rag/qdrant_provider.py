"""
Shared Qdrant client provider.
Ensures a single client instance is reused across indexer/retriever.
"""

import os
from pathlib import Path
from typing import Optional

from qdrant_client import QdrantClient

from config.settings import settings
from config.logging_config import get_logger

logger = get_logger(__name__)

_qdrant_client: Optional[QdrantClient] = None


def get_qdrant_client() -> QdrantClient:
    """Get a shared Qdrant client with cloud-first strategy and local fallback."""
    global _qdrant_client

    if _qdrant_client is not None:
        return _qdrant_client

    has_cloud_config = bool(settings.qdrant_url and settings.qdrant_api_key)

    if has_cloud_config:
        try:
            client = QdrantClient(
                url=settings.qdrant_url,
                api_key=settings.qdrant_api_key,
                timeout=30
            )
            client.get_collections()
            logger.info("Connected to Qdrant Cloud successfully")
            _qdrant_client = client
            return _qdrant_client
        except Exception as e:
            message = (
                "Failed to connect to configured Qdrant Cloud. "
                "Check QDRANT_URL, QDRANT_API_KEY, and that the cluster is running."
            )
            logger.error("%s Error: %s", message, e)
            raise RuntimeError(message) from e

    if os.environ.get("VERCEL") or os.environ.get("RENDER"):
        raise RuntimeError(
            "QDRANT_URL and QDRANT_API_KEY are required in production; "
            "local Qdrant fallback is only available during development."
        )

    local_path = Path("data") / "qdrant"
    local_path.mkdir(parents=True, exist_ok=True)

    logger.warning(
        "Qdrant Cloud credentials are not configured. "
        "Falling back to local Qdrant at: %s",
        local_path.as_posix(),
    )

    _qdrant_client = QdrantClient(path=str(local_path))
    return _qdrant_client
