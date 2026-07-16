"""
RAG Retrieval — query → embed → search → rerank → guard → generate.

Pass 2 hardening:
- Tenacity retries with exponential backoff on every external call.
- Optional HyDE query rewriting (settings.enable_hyde).
- MMR reranking with overfetch (settings.enable_mmr, settings.overfetch_multiplier).
- Hallucination guard: if the best chunk scores below
  settings.hallucination_guard_score, return DEFAULT_NO_ANSWER without
  hitting the LLM.
- Stage-level timing telemetry on every query.
"""

from __future__ import annotations

import re
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from openai import (
    APIConnectionError,
    APIError,
    APITimeoutError,
    AsyncOpenAI,
    InternalServerError,
    RateLimitError,
)
from qdrant_client import QdrantClient  # re-exported for test patching
from qdrant_client.models import FieldCondition, Filter, MatchValue
from tenacity import (
    AsyncRetrying,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from config.constants import (
    CHAT_HISTORY_COLLECTION,
    DEFAULT_NO_ANSWER,
    HYDE_PROMPT_TEMPLATE,
    LLM_TIMEOUT,
    MAX_SOURCES_RETURNED,
    MIN_SIMILARITY_SCORE,
    RAG_PROMPT_TEMPLATE,
    SYSTEM_PROMPT,
)
from config.logging_config import get_logger
from config.settings import settings
from rag.qdrant_provider import get_qdrant_client
from rag.mongo_provider import get_mongo
from rag.rerank import mmr_rerank
from rag.utils import truncate_text

logger = get_logger(__name__)


# Errors that are worth retrying — transient network / rate / 5xx issues.
_RETRYABLE = (
    APIConnectionError,
    APITimeoutError,
    InternalServerError,
    RateLimitError,
)


class RAGRetriever:
    """Document retriever and response generator for the RAG system."""

    def __init__(self) -> None:
        self._initialize_clients()

    # ------------------------------------------------------------------
    # Setup
    # ------------------------------------------------------------------
    def _initialize_clients(self) -> None:
        logger.info("Initializing RAG Retriever clients…")
        self.qdrant_client = get_qdrant_client()
        # Mongo is optional (chat history only)
        self.mongo_client, self.mongo_db = get_mongo()
        self.openai_client = AsyncOpenAI(
            api_key=settings.openrouter_api_key,
            base_url=settings.openrouter_base_url,
            timeout=LLM_TIMEOUT,
        )
        logger.info("Retriever clients ready (mongo=%s)", self.mongo_db is not None)

    # ------------------------------------------------------------------
    # External calls (with retry)
    # ------------------------------------------------------------------
    async def generate_query_embedding(self, query: str) -> List[float]:
        """Public alias kept for backwards compatibility with older callers/tests."""
        return await self._embed(query)

    async def _embed(self, text: str) -> List[float]:
        """Embed a single string. Retries on transient errors."""
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(settings.embedding_max_retries),
            wait=wait_exponential(multiplier=0.5, min=0.5, max=8),
            retry=retry_if_exception_type(_RETRYABLE),
            reraise=True,
        ):
            with attempt:
                resp = await self.openai_client.embeddings.create(
                    model=settings.embedding_model,
                    input=text,
                )
                return resp.data[0].embedding
        # Unreachable, but the type checker doesn't know that.
        raise RuntimeError("embedding retry loop exited without result")

    async def _complete(
        self,
        system: str,
        user: str,
        *,
        temperature: float,
        max_tokens: int,
    ) -> str:
        """Chat completion with retry + a graceful 402-credits fallback."""
        async for attempt in AsyncRetrying(
            stop=stop_after_attempt(settings.llm_max_retries),
            wait=wait_exponential(multiplier=0.5, min=0.5, max=6),
            retry=retry_if_exception_type(_RETRYABLE),
            reraise=True,
        ):
            with attempt:
                try:
                    resp = await self.openai_client.chat.completions.create(
                        model=settings.llm_model,
                        messages=[
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        temperature=temperature,
                        max_tokens=max_tokens,
                    )
                    return resp.choices[0].message.content or ""
                except APIError as e:
                    # OpenRouter returns 402 with "can only afford N tokens" — retry once
                    # with a reduced budget instead of giving up.
                    msg = str(e)
                    if "402" in msg or "insufficient" in msg.lower():
                        affordable = self._extract_affordable_tokens(msg)
                        if affordable and affordable > 32:
                            retry_tokens = min(max_tokens, affordable)
                            logger.warning(
                                "Insufficient credits; retrying with max_tokens=%d",
                                retry_tokens,
                            )
                            resp = await self.openai_client.chat.completions.create(
                                model=settings.llm_model,
                                messages=[
                                    {"role": "system", "content": system},
                                    {"role": "user", "content": user},
                                ],
                                temperature=temperature,
                                max_tokens=retry_tokens,
                            )
                            return resp.choices[0].message.content or ""
                    raise
        raise RuntimeError("completion retry loop exited without result")

    @staticmethod
    def _extract_affordable_tokens(error_text: str) -> Optional[int]:
        match = re.search(r"can only afford\s+(\d+)", error_text)
        if not match:
            return None
        try:
            return int(match.group(1))
        except ValueError:
            return None

    # ------------------------------------------------------------------
    # Query rewriting (HyDE)
    # ------------------------------------------------------------------
    async def _hyde_rewrite(self, query: str) -> str:
        """Generate a hypothetical answer paragraph and return it for embedding."""
        try:
            paragraph = await self._complete(
                system="You write concise hypothetical passages for retrieval.",
                user=HYDE_PROMPT_TEMPLATE.format(question=query),
                temperature=0.3,
                max_tokens=180,
            )
            paragraph = (paragraph or "").strip()
            if not paragraph:
                return query
            # Concatenate so the embedding still anchors on the literal terms.
            return f"{query}\n\n{paragraph}"
        except Exception as e:
            logger.warning("HyDE rewrite failed (%s); falling back to raw query", e)
            return query

    # ------------------------------------------------------------------
    # Vector search
    # ------------------------------------------------------------------
    async def retrieve_relevant_documents(
        self,
        query: str,
        top_k: Optional[int] = None,
        score_threshold: Optional[float] = None,
        filter_source: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Embed the query, search Qdrant, return ranked chunks."""
        top_k = top_k or settings.top_k
        score_threshold = (
            score_threshold if score_threshold is not None else settings.similarity_threshold
        )

        embed_text = (
            await self._hyde_rewrite(query) if settings.enable_hyde else query
        )
        query_embedding = await self._embed(embed_text)

        search_filter = None
        if filter_source:
            search_filter = Filter(
                must=[FieldCondition(key="source", match=MatchValue(value=filter_source))]
            )

        # Overfetch so MMR has something to pick from.
        overfetch_k = top_k * settings.overfetch_multiplier if settings.enable_mmr else top_k

        results = self.qdrant_client.search(
            collection_name=settings.qdrant_collection,
            query_vector=query_embedding,
            limit=overfetch_k,
            score_threshold=score_threshold,
            query_filter=search_filter,
            with_vectors=settings.enable_mmr,  # Need vectors for MMR; otherwise skip the cost.
        )

        if not results:
            return []

        candidates = [
            {
                "text": r.payload.get("text", ""),
                "source": r.payload.get("source", "unknown"),
                "url": r.payload.get("url", ""),
                "document_id": r.payload.get("document_id", ""),
                "chunk_index": r.payload.get("chunk_index", 0),
                "score": round(r.score, 4),
                "metadata": r.payload.get("metadata", {}),
                "_vector": r.vector if settings.enable_mmr else None,
            }
            for r in results
        ]

        if settings.enable_mmr and len(candidates) > top_k:
            keep = mmr_rerank(
                query_embedding=query_embedding,
                candidate_embeddings=[c["_vector"] for c in candidates],
                candidate_scores=[c["score"] for c in candidates],
                top_k=top_k,
                lambda_mult=settings.mmr_lambda,
            )
            candidates = [candidates[i] for i in keep]
        else:
            candidates = candidates[:top_k]

        # Strip the internal vector before returning.
        for c in candidates:
            c.pop("_vector", None)

        return candidates

    # ------------------------------------------------------------------
    # Generation
    # ------------------------------------------------------------------
    async def generate_response(
        self,
        query: str,
        context: str,
        system_prompt: Optional[str] = None,
    ) -> str:
        return await self._complete(
            system=system_prompt or SYSTEM_PROMPT,
            user=RAG_PROMPT_TEMPLATE.format(context=context, question=query),
            temperature=settings.temperature,
            max_tokens=settings.max_tokens,
        )

    # ------------------------------------------------------------------
    # End-to-end pipeline
    # ------------------------------------------------------------------
    async def query(
        self,
        user_query: str,
        session_id: Optional[str] = None,
        top_k: Optional[int] = None,
        filter_source: Optional[str] = None,
    ) -> Dict[str, Any]:
        start = time.perf_counter()
        timings: Dict[str, int] = {}

        try:
            logger.info("query.start q=%s", user_query[:80])

            # Stage 1 — retrieve
            t0 = time.perf_counter()
            docs = await self.retrieve_relevant_documents(
                query=user_query, top_k=top_k, filter_source=filter_source
            )
            timings["retrieve_ms"] = int((time.perf_counter() - t0) * 1000)
            logger.info(
                "query.retrieve hits=%d top_score=%s ms=%d",
                len(docs),
                f"{docs[0]['score']:.3f}" if docs else "n/a",
                timings["retrieve_ms"],
            )

            # No-results path
            if not docs:
                return self._empty_result(
                    user_query, start, "no_results", timings, session_id
                )

            # Hallucination guard — best chunk too weak to ground a real answer.
            best_score = docs[0]["score"]
            if best_score < settings.hallucination_guard_score:
                logger.warning(
                    "query.guard_triggered best_score=%.3f < threshold=%.3f",
                    best_score,
                    settings.hallucination_guard_score,
                )
                return self._empty_result(
                    user_query, start, "low_confidence", timings, session_id, docs
                )

            # Stage 2 — build context
            context = "\n\n---\n\n".join(
                f"[Source: {d.get('source', 'document')}]\n{d.get('text', '')}"
                for d in docs
            )

            # Stage 3 — generate
            t1 = time.perf_counter()
            answer = await self.generate_response(user_query, context)
            timings["generate_ms"] = int((time.perf_counter() - t1) * 1000)
            logger.info("query.generate ms=%d", timings["generate_ms"])

            sources = [
                {
                    "source": d["source"],
                    "url": d["url"],
                    "text": truncate_text(d["text"], 200),
                    "score": d["score"],
                    "chunk_index": d["chunk_index"],
                }
                for d in docs[:MAX_SOURCES_RETURNED]
            ]

            result = {
                "answer": answer,
                "sources": sources,
                "query": user_query,
                "documents_retrieved": len(docs),
                "processing_time_ms": int((time.perf_counter() - start) * 1000),
                "timings": timings,
                "status": "success",
            }

            if session_id:
                await self._store_chat_history(session_id, user_query, result)

            logger.info(
                "query.done total_ms=%d status=success", result["processing_time_ms"]
            )
            return result

        except Exception as e:
            logger.exception("query.error %s", e)
            return {
                "answer": (
                    "I hit an error while processing that. Please try again — "
                    "if the problem continues, the model or vector store may be unreachable."
                ),
                "sources": [],
                "query": user_query,
                "processing_time_ms": int((time.perf_counter() - start) * 1000),
                "timings": timings,
                "status": "error",
                "error": type(e).__name__,
            }

    def _empty_result(
        self,
        user_query: str,
        start: float,
        status: str,
        timings: Dict[str, int],
        session_id: Optional[str],
        docs: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        sources = []
        if docs:
            # Surface what we did find so the user can see why we backed off.
            sources = [
                {
                    "source": d["source"],
                    "url": d["url"],
                    "text": truncate_text(d["text"], 200),
                    "score": d["score"],
                    "chunk_index": d["chunk_index"],
                }
                for d in docs[:MAX_SOURCES_RETURNED]
            ]
        result = {
            "answer": DEFAULT_NO_ANSWER,
            "sources": sources,
            "query": user_query,
            "documents_retrieved": len(docs) if docs else 0,
            "processing_time_ms": int((time.perf_counter() - start) * 1000),
            "timings": timings,
            "status": status,
        }
        if session_id:
            # Fire-and-forget; failure doesn't matter here.
            try:
                import asyncio
                asyncio.create_task(self._store_chat_history(session_id, user_query, result))
            except Exception:
                pass
        return result

    # ------------------------------------------------------------------
    # History
    # ------------------------------------------------------------------
    async def _store_chat_history(
        self, session_id: str, query: str, result: Dict[str, Any]
    ) -> None:
        if self.mongo_db is None:
            return
        try:
            await self.mongo_db[CHAT_HISTORY_COLLECTION].insert_one(
                {
                    "session_id": session_id,
                    "query": query,
                    "answer": result.get("answer", ""),
                    "sources": result.get("sources", []),
                    "status": result.get("status", ""),
                    "processing_time_ms": result.get("processing_time_ms", 0),
                    "timings": result.get("timings", {}),
                    "timestamp": datetime.utcnow(),
                }
            )
        except Exception as e:
            logger.error("history.store_failed %s", e)

    async def get_chat_history(
        self, session_id: str, limit: int = 10
    ) -> List[Dict[str, Any]]:
        if self.mongo_db is None:
            return []
        try:
            cursor = (
                self.mongo_db[CHAT_HISTORY_COLLECTION]
                .find({"session_id": session_id})
                .sort("timestamp", -1)
                .limit(limit)
            )
            history = await cursor.to_list(length=limit)
            for entry in history:
                entry["_id"] = str(entry["_id"])
            return history[::-1]
        except Exception as e:
            logger.error("history.fetch_failed %s", e)
            return []

    async def search_similar_documents(
        self, query: str, top_k: int = 10
    ) -> List[Dict[str, Any]]:
        return await self.retrieve_relevant_documents(
            query=query, top_k=top_k, score_threshold=MIN_SIMILARITY_SCORE
        )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def close(self) -> None:
        try:
            if self.mongo_client is not None:
                self.mongo_client.close()
            logger.info("Retriever connections closed")
        except Exception as e:
            logger.error("close.error %s", e)
