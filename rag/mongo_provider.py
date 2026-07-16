"""
Shared MongoDB client provider.

Mongo is used for document metadata and chat history only.
If MONGO_URI is missing or the cluster is unreachable at init time,
we degrade gracefully so Qdrant-based indexing/query still works.
"""

from __future__ import annotations

from typing import Any, Optional, Tuple

from config.logging_config import get_logger
from config.settings import settings

logger = get_logger(__name__)

_mongo_client: Any = None
_mongo_db: Any = None
_init_attempted: bool = False
_mongo_available: bool = False


def get_mongo() -> Tuple[Optional[Any], Optional[Any]]:
    """
    Return (client, db) or (None, None) when Mongo is unavailable.

    Client construction is attempted once and cached.
    """
    global _mongo_client, _mongo_db, _init_attempted, _mongo_available

    if _init_attempted:
        return _mongo_client, _mongo_db

    _init_attempted = True

    if not settings.mongo_uri:
        logger.warning("MONGO_URI is not configured; metadata/history features disabled")
        return None, None

    try:
        from motor.motor_asyncio import AsyncIOMotorClient

        client = AsyncIOMotorClient(
            settings.mongo_uri,
            serverSelectionTimeoutMS=5000,
        )
        db = client[settings.mongo_db_name]
        _mongo_client = client
        _mongo_db = db
        _mongo_available = True
        logger.info("MongoDB client initialized (db=%s)", settings.mongo_db_name)
        return _mongo_client, _mongo_db
    except Exception as e:
        logger.error(
            "MongoDB unavailable — continuing without metadata/history. Error: %s",
            e,
        )
        _mongo_client = None
        _mongo_db = None
        _mongo_available = False
        return None, None


def is_mongo_available() -> bool:
    """Whether Mongo was successfully initialized."""
    if not _init_attempted:
        get_mongo()
    return _mongo_available
