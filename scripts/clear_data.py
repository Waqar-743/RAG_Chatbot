"""Destructively clear application data from Qdrant and MongoDB."""

from __future__ import annotations

import argparse
import os
import sys
from typing import List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pymongo import MongoClient
from qdrant_client import QdrantClient

from config.constants import (
    CHAT_HISTORY_COLLECTION,
    DOCUMENTS_COLLECTION,
    METADATA_COLLECTION,
)
from config.settings import settings


def clear_mongo() -> bool:
    """Delete every document from the application's MongoDB collections."""
    if not settings.mongo_uri:
        print("MongoDB: skipped (MONGO_URI is not configured)")
        return True

    client = MongoClient(settings.mongo_uri, serverSelectionTimeoutMS=10_000)
    try:
        client.admin.command("ping")
        database = client[settings.mongo_db_name]
        for collection in (
            DOCUMENTS_COLLECTION,
            CHAT_HISTORY_COLLECTION,
            METADATA_COLLECTION,
        ):
            deleted = database[collection].delete_many({}).deleted_count
            remaining = database[collection].count_documents({})
            if remaining:
                raise RuntimeError(
                    f"MongoDB collection {collection!r} still has {remaining} documents"
                )
            print(f"MongoDB {collection}: deleted {deleted}; remaining 0")
        return True
    except Exception as exc:
        print(f"MongoDB cleanup could not be verified: {exc}")
        return False
    finally:
        client.close()


def clear_qdrant() -> bool:
    """Delete the entire configured collection and verify it is absent."""
    if not settings.qdrant_url or not settings.qdrant_api_key:
        print("Qdrant: skipped (QDRANT_URL or QDRANT_API_KEY is missing)")
        return False

    client = QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
        timeout=30,
    )
    try:
        names: List[str] = [item.name for item in client.get_collections().collections]
        if settings.qdrant_collection in names:
            points = client.get_collection(settings.qdrant_collection).points_count or 0
            client.delete_collection(settings.qdrant_collection)
            print(
                f"Qdrant {settings.qdrant_collection}: deleted collection "
                f"containing {points} points"
            )
        else:
            print(f"Qdrant {settings.qdrant_collection}: already absent (0 points)")

        remaining = [item.name for item in client.get_collections().collections]
        if settings.qdrant_collection in remaining:
            raise RuntimeError("collection still exists after deletion")
        print("Qdrant cleanup verified")
        return True
    except Exception as exc:
        print(f"Qdrant cleanup could not be verified: {exc}")
        return False
    finally:
        client.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Confirm permanent deletion without an interactive prompt",
    )
    parser.add_argument("--skip-mongo", action="store_true")
    parser.add_argument("--skip-qdrant", action="store_true")
    args = parser.parse_args()

    if not args.yes:
        parser.error("refusing destructive cleanup without --yes")

    results = []
    if not args.skip_mongo:
        results.append(clear_mongo())
    if not args.skip_qdrant:
        results.append(clear_qdrant())

    return 0 if results and all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
