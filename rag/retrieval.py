"""
RAG Retrieval Module.
Handles query processing, semantic search, and response generation.
"""

import asyncio
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
import re

from openai import AsyncOpenAI
from qdrant_client import QdrantClient
from qdrant_client.models import Filter, FieldCondition, MatchValue
from motor.motor_asyncio import AsyncIOMotorClient

from config.settings import settings
from config.constants import (
    VECTOR_DIMENSION,
    MAX_SOURCES_RETURNED,
    MIN_SIMILARITY_SCORE,
    DEFAULT_NO_ANSWER,
    SYSTEM_PROMPT,
    RAG_PROMPT_TEMPLATE,
    LLM_TIMEOUT,
    EMBEDDING_TIMEOUT,
    CHAT_HISTORY_COLLECTION
)
from config.logging_config import get_logger
from rag.qdrant_provider import get_qdrant_client
from rag.utils import truncate_text, get_timestamp

logger = get_logger(__name__)


class RAGRetriever:
    """
    Document Retriever and Response Generator for RAG system.
    Handles semantic search and LLM-powered response generation.
    """
    
    def __init__(self):
        """Initialize the RAG Retriever with necessary clients."""
        self._initialize_clients()
    
    def _initialize_clients(self):
        """Initialize API clients."""
        logger.info("Initializing RAG Retriever clients...")

        # Shared Qdrant client for vector search
        self.qdrant_client = get_qdrant_client()
        
        # MongoDB async client for chat history
        self.mongo_client = AsyncIOMotorClient(settings.mongo_uri)
        self.mongo_db = self.mongo_client[settings.mongo_db_name]
        
        # OpenAI client (configured for OpenRouter)
        self.openai_client = AsyncOpenAI(
            api_key=settings.openrouter_api_key,
            base_url=settings.openrouter_base_url,
            timeout=LLM_TIMEOUT
        )
        
        logger.info("Retriever clients initialized successfully")
    
    async def generate_query_embedding(self, query: str) -> List[float]:
        """
        Generate embedding for user query.
        
        Args:
            query: User's query text
            
        Returns:
            Embedding vector
        """
        try:
            response = await self.openai_client.embeddings.create(
                model=settings.embedding_model,
                input=query
            )
            return response.data[0].embedding
            
        except Exception as e:
            logger.error(f"Error generating query embedding: {e}")
            raise
    
    async def retrieve_relevant_documents(
        self, 
        query: str,
        top_k: Optional[int] = None,
        score_threshold: Optional[float] = None,
        filter_source: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Retrieve relevant documents for a query using semantic search.
        
        Args:
            query: User's query text
            top_k: Number of documents to retrieve (default from settings)
            score_threshold: Minimum similarity score (default from settings)
            filter_source: Optional filter by source name
            
        Returns:
            List of relevant document chunks with metadata
        """
        top_k = top_k or settings.top_k
        score_threshold = score_threshold or settings.similarity_threshold
        
        try:
            logger.info(f"Retrieving documents for query: {query[:50]}...")
            
            # Generate query embedding
            query_embedding = await self.generate_query_embedding(query)
            
            # Build filter if source is specified
            search_filter = None
            if filter_source:
                search_filter = Filter(
                    must=[
                        FieldCondition(
                            key="source",
                            match=MatchValue(value=filter_source)
                        )
                    ]
                )
            
            # Search in Qdrant
            search_results = self.qdrant_client.search(
                collection_name=settings.qdrant_collection,
                query_vector=query_embedding,
                limit=top_k,
                score_threshold=score_threshold,
                query_filter=search_filter
            )
            
            # Format results
            documents = []
            for result in search_results:
                documents.append({
                    "text": result.payload.get("text", ""),
                    "source": result.payload.get("source", "unknown"),
                    "url": result.payload.get("url", ""),
                    "document_id": result.payload.get("document_id", ""),
                    "chunk_index": result.payload.get("chunk_index", 0),
                    "score": round(result.score, 4),
                    "metadata": result.payload.get("metadata", {})
                })
            
            logger.info(f"Retrieved {len(documents)} relevant documents")
            return documents
            
        except Exception as e:
            logger.error(f"Error retrieving documents: {e}")
            raise
    
    async def generate_response(
        self, 
        query: str, 
        context: str,
        system_prompt: Optional[str] = None
    ) -> str:
        """
        Generate LLM response based on query and context.
        
        Args:
            query: User's question
            context: Retrieved document context
            system_prompt: Optional custom system prompt
            
        Returns:
            Generated response text
        """
        try:
            # Use default or custom system prompt
            sys_prompt = system_prompt or SYSTEM_PROMPT
            
            # Format user prompt with context
            user_prompt = RAG_PROMPT_TEMPLATE.format(
                context=context,
                question=query
            )
            
            logger.debug(f"Generating response for query: {query[:50]}...")
            
            # Call LLM via OpenRouter
            response = await self.openai_client.chat.completions.create(
                model=settings.llm_model,
                messages=[
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=settings.temperature,
                max_tokens=settings.max_tokens
            )
            
            answer = response.choices[0].message.content
            logger.debug("Response generated successfully")
            
            return answer
            
        except Exception as e:
            error_text = str(e)

            # Graceful retry for OpenRouter insufficient credits errors
            if "Error code: 402" in error_text:
                affordable_tokens = self._extract_affordable_tokens(error_text)
                if affordable_tokens and affordable_tokens > 32:
                    retry_tokens = min(settings.max_tokens, affordable_tokens)
                    logger.warning(
                        f"Retrying LLM response with reduced max_tokens={retry_tokens} due to credits limit"
                    )
                    try:
                        retry_response = await self.openai_client.chat.completions.create(
                            model=settings.llm_model,
                            messages=[
                                {"role": "system", "content": sys_prompt},
                                {"role": "user", "content": user_prompt}
                            ],
                            temperature=settings.temperature,
                            max_tokens=retry_tokens
                        )

                        retry_answer = retry_response.choices[0].message.content
                        logger.debug("Response generated successfully after reduced-token retry")
                        return retry_answer
                    except Exception as retry_error:
                        logger.error(f"Retry with reduced tokens also failed: {retry_error}")

            logger.error(f"Error generating LLM response: {e}")
            raise

    def _extract_affordable_tokens(self, error_text: str) -> Optional[int]:
        """Extract affordable token count from OpenRouter 402 error text."""
        match = re.search(r"can only afford\s+(\d+)", error_text)
        if not match:
            return None

        try:
            return int(match.group(1))
        except ValueError:
            return None
    
    async def query(
        self, 
        user_query: str,
        session_id: Optional[str] = None,
        top_k: Optional[int] = None,
        filter_source: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Complete RAG query pipeline: retrieve → generate → return.
        
        Args:
            user_query: User's question
            session_id: Optional session ID for chat history
            top_k: Number of documents to retrieve
            filter_source: Optional filter by source
            
        Returns:
            Response dictionary with answer and sources
        """
        start_time = datetime.utcnow()
        
        try:
            logger.info(f"Processing query: {user_query[:100]}...")
            
            # Step 1: Retrieve relevant documents
            retrieved_docs = await self.retrieve_relevant_documents(
                query=user_query,
                top_k=top_k,
                filter_source=filter_source
            )
            
            # Handle no results
            if not retrieved_docs:
                logger.warning("No relevant documents found for query")
                result = {
                    "answer": DEFAULT_NO_ANSWER,
                    "sources": [],
                    "query": user_query,
                    "processing_time_ms": self._calculate_time(start_time),
                    "status": "no_results"
                }
                
                # Store in history
                if session_id:
                    await self._store_chat_history(session_id, user_query, result)
                
                return result
            
            # Step 2: Build context from retrieved documents
            context_parts = []
            for i, doc in enumerate(retrieved_docs):
                source_label = doc.get("source", "Document")
                text = doc.get("text", "")
                context_parts.append(f"[Source: {source_label}]\n{text}")
            
            context = "\n\n---\n\n".join(context_parts)
            
            # Step 3: Generate response
            answer = await self.generate_response(user_query, context)
            
            # Step 4: Format sources for response
            sources = [
                {
                    "source": doc["source"],
                    "url": doc["url"],
                    "text": truncate_text(doc["text"], 200),
                    "score": doc["score"],
                    "chunk_index": doc["chunk_index"]
                }
                for doc in retrieved_docs[:MAX_SOURCES_RETURNED]
            ]
            
            # Build response
            result = {
                "answer": answer,
                "sources": sources,
                "query": user_query,
                "documents_retrieved": len(retrieved_docs),
                "processing_time_ms": self._calculate_time(start_time),
                "status": "success"
            }
            
            # Store in chat history
            if session_id:
                await self._store_chat_history(session_id, user_query, result)
            
            logger.info(f"Query processed successfully in {result['processing_time_ms']}ms")
            return result
            
        except Exception as e:
            logger.error(f"Error in query pipeline: {e}")
            return {
                "answer": "I encountered an error while processing your question. Please try again.",
                "sources": [],
                "query": user_query,
                "processing_time_ms": self._calculate_time(start_time),
                "status": "error",
                "error": str(e)
            }
    
    async def _store_chat_history(
        self, 
        session_id: str, 
        query: str, 
        result: Dict[str, Any]
    ):
        """Store chat interaction in MongoDB."""
        try:
            chat_entry = {
                "session_id": session_id,
                "query": query,
                "answer": result.get("answer", ""),
                "sources": result.get("sources", []),
                "status": result.get("status", ""),
                "processing_time_ms": result.get("processing_time_ms", 0),
                "timestamp": datetime.utcnow()
            }
            
            await self.mongo_db[CHAT_HISTORY_COLLECTION].insert_one(chat_entry)
            logger.debug(f"Stored chat history for session: {session_id}")
            
        except Exception as e:
            logger.error(f"Error storing chat history: {e}")
            # Don't raise - history storage failure shouldn't break the response
    
    async def get_chat_history(
        self, 
        session_id: str, 
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Retrieve chat history for a session.
        
        Args:
            session_id: Session identifier
            limit: Maximum number of entries to return
            
        Returns:
            List of chat history entries
        """
        try:
            cursor = self.mongo_db[CHAT_HISTORY_COLLECTION].find(
                {"session_id": session_id}
            ).sort("timestamp", -1).limit(limit)
            
            history = await cursor.to_list(length=limit)
            
            # Convert ObjectId to string
            for entry in history:
                entry["_id"] = str(entry["_id"])
            
            return history[::-1]  # Return in chronological order
            
        except Exception as e:
            logger.error(f"Error retrieving chat history: {e}")
            return []
    
    async def search_similar_documents(
        self,
        query: str,
        top_k: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Search for similar documents without generating a response.
        Useful for document discovery and exploration.
        
        Args:
            query: Search query
            top_k: Number of results
            
        Returns:
            List of similar documents
        """
        return await self.retrieve_relevant_documents(
            query=query,
            top_k=top_k,
            score_threshold=MIN_SIMILARITY_SCORE
        )
    
    def _calculate_time(self, start_time: datetime) -> int:
        """Calculate elapsed time in milliseconds."""
        elapsed = datetime.utcnow() - start_time
        return int(elapsed.total_seconds() * 1000)
    
    def close(self):
        """Close all client connections."""
        try:
            self.mongo_client.close()
            logger.info("Retriever connections closed")
        except Exception as e:
            logger.error(f"Error closing connections: {e}")
