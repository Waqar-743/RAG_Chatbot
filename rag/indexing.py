"""
RAG Indexing Module.
Handles document processing, chunking, embedding generation, and storage.
"""

import asyncio
from typing import List, Dict, Any, Optional
from datetime import datetime
import hashlib

from openai import AsyncOpenAI
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance, 
    PointStruct, 
    VectorParams,
    models
)
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient

from config.settings import settings
from config.constants import (
    VECTOR_DIMENSION,
    DOCUMENTS_COLLECTION,
    METADATA_COLLECTION,
    EMBEDDING_TIMEOUT,
    MAX_CONTENT_LENGTH
)
from config.logging_config import get_logger
from rag.qdrant_provider import get_qdrant_client
from rag.utils import (
    chunk_text, 
    generate_document_id, 
    generate_uuid,
    clean_text,
    get_timestamp
)

logger = get_logger(__name__)


class RAGIndexer:
    """
    Document Indexer for RAG system.
    Handles document chunking, embedding generation, and vector storage.
    """
    
    def __init__(self):
        """Initialize the RAG Indexer with necessary clients."""
        self._initialize_clients()
        self._initialize_collections()
    
    def _initialize_clients(self):
        """Initialize API clients for Qdrant, MongoDB, and OpenAI."""
        logger.info("Initializing RAG Indexer clients...")

        # Shared Qdrant client for vector storage
        self.qdrant_client = get_qdrant_client()
        
        # MongoDB async client for metadata
        self.mongo_client = AsyncIOMotorClient(settings.mongo_uri)
        self.mongo_db = self.mongo_client[settings.mongo_db_name]
        
        # OpenAI client (configured for OpenRouter)
        self.openai_client = AsyncOpenAI(
            api_key=settings.openrouter_api_key,
            base_url=settings.openrouter_base_url,
            timeout=EMBEDDING_TIMEOUT
        )
        
        logger.info("All clients initialized successfully")
    
    def _initialize_collections(self):
        """Initialize Qdrant collection if it doesn't exist."""
        try:
            # Check if collection exists
            collections = self.qdrant_client.get_collections()
            collection_names = [c.name for c in collections.collections]
            
            if settings.qdrant_collection not in collection_names:
                logger.info(f"Creating Qdrant collection: {settings.qdrant_collection}")
                self.qdrant_client.create_collection(
                    collection_name=settings.qdrant_collection,
                    vectors_config=VectorParams(
                        size=VECTOR_DIMENSION,
                        distance=Distance.COSINE
                    )
                )
                logger.info(f"Collection {settings.qdrant_collection} created successfully")
            else:
                logger.info(f"Collection {settings.qdrant_collection} already exists")
                
        except Exception as e:
            logger.error(f"Error initializing Qdrant collection: {e}")
            raise
    
    async def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for a list of texts using OpenRouter.
        
        Args:
            texts: List of text strings to embed
            
        Returns:
            List of embedding vectors
        """
        if not texts:
            return []
        
        try:
            logger.debug(f"Generating embeddings for {len(texts)} texts")
            
            # OpenRouter embedding request
            response = await self.openai_client.embeddings.create(
                model=settings.embedding_model,
                input=texts
            )
            
            # Extract embeddings from response
            embeddings = [item.embedding for item in response.data]
            
            logger.debug(f"Successfully generated {len(embeddings)} embeddings")
            return embeddings
            
        except Exception as e:
            logger.error(f"Error generating embeddings: {e}")
            raise
    
    async def index_document(self, document: Dict[str, Any]) -> Dict[str, Any]:
        """
        Index a single document.
        
        Args:
            document: Dictionary containing:
                - source: Document identifier/name
                - content: Full text content
                - url: Optional URL source
                - metadata: Optional additional metadata
                
        Returns:
            Indexing result with status and chunk count
        """
        try:
            source = document.get("source", "unknown")
            content = document.get("content", "")
            url = document.get("url", "")
            metadata = document.get("metadata", {})
            
            logger.info(f"Indexing document: {source}")
            
            # Validate content
            if not content or not content.strip():
                return {
                    "status": "error",
                    "message": "Empty document content",
                    "source": source
                }
            
            # Truncate if too long
            if len(content) > MAX_CONTENT_LENGTH:
                logger.warning(f"Document {source} truncated from {len(content)} to {MAX_CONTENT_LENGTH} chars")
                content = content[:MAX_CONTENT_LENGTH]
            
            # Generate document ID
            document_id = generate_document_id(source, content)
            
            # Chunk the document
            chunks = chunk_text(
                text=content,
                chunk_size=settings.chunk_size,
                overlap=settings.chunk_overlap
            )
            
            if not chunks:
                return {
                    "status": "error",
                    "message": "No chunks generated",
                    "source": source
                }
            
            logger.info(f"Generated {len(chunks)} chunks for document: {source}")
            
            # Generate embeddings for all chunks
            chunk_texts = [chunk["text"] for chunk in chunks]
            embeddings = await self.generate_embeddings(chunk_texts)
            
            # Prepare points for Qdrant
            points = []
            for idx, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
                point_id = abs(hash(f"{document_id}_{idx}")) % (2**63)  # Ensure positive int
                
                points.append(PointStruct(
                    id=point_id,
                    vector=embedding,
                    payload={
                        "document_id": document_id,
                        "source": source,
                        "url": url,
                        "chunk_index": idx,
                        "text": chunk["text"],
                        "start_char": chunk["start_char"],
                        "end_char": chunk["end_char"],
                        "metadata": metadata,
                        "indexed_at": get_timestamp()
                    }
                ))
            
            # Upsert to Qdrant
            self.qdrant_client.upsert(
                collection_name=settings.qdrant_collection,
                points=points
            )
            
            logger.info(f"Successfully indexed {len(points)} chunks to Qdrant")
            
            # Store document metadata in MongoDB
            await self._store_document_metadata(
                document_id=document_id,
                source=source,
                url=url,
                content_length=len(content),
                chunk_count=len(chunks),
                metadata=metadata
            )
            
            return {
                "status": "success",
                "document_id": document_id,
                "source": source,
                "chunks_indexed": len(chunks),
                "message": f"Successfully indexed {len(chunks)} chunks"
            }
            
        except Exception as e:
            logger.error(f"Error indexing document {document.get('source', 'unknown')}: {e}")
            return {
                "status": "error",
                "source": document.get("source", "unknown"),
                "message": str(e)
            }
    
    async def index_documents(self, documents: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Index multiple documents.
        
        Args:
            documents: List of document dictionaries
            
        Returns:
            Summary of indexing results
        """
        logger.info(f"Starting batch indexing of {len(documents)} documents")
        
        results = {
            "total": len(documents),
            "successful": 0,
            "failed": 0,
            "total_chunks": 0,
            "details": []
        }
        
        for doc in documents:
            result = await self.index_document(doc)
            results["details"].append(result)
            
            if result["status"] == "success":
                results["successful"] += 1
                results["total_chunks"] += result.get("chunks_indexed", 0)
            else:
                results["failed"] += 1
        
        logger.info(
            f"Batch indexing complete: {results['successful']}/{results['total']} successful, "
            f"{results['total_chunks']} total chunks"
        )
        
        return results
    
    async def _store_document_metadata(
        self,
        document_id: str,
        source: str,
        url: str,
        content_length: int,
        chunk_count: int,
        metadata: Dict
    ):
        """Store document metadata in MongoDB."""
        try:
            doc_metadata = {
                "document_id": document_id,
                "source": source,
                "url": url,
                "content_length": content_length,
                "chunk_count": chunk_count,
                "metadata": metadata,
                "indexed_at": datetime.utcnow(),
                "updated_at": datetime.utcnow()
            }
            
            # Upsert document metadata
            await self.mongo_db[DOCUMENTS_COLLECTION].update_one(
                {"document_id": document_id},
                {"$set": doc_metadata},
                upsert=True
            )
            
            logger.debug(f"Stored metadata for document: {source}")
            
        except Exception as e:
            logger.error(f"Error storing document metadata: {e}")
            # Don't raise - metadata storage failure shouldn't block indexing
    
    async def delete_document(self, document_id: str) -> Dict[str, Any]:
        """
        Delete a document and its chunks from the index.
        
        Args:
            document_id: ID of the document to delete
            
        Returns:
            Deletion result
        """
        try:
            logger.info(f"Deleting document: {document_id}")
            
            # Delete from Qdrant
            self.qdrant_client.delete(
                collection_name=settings.qdrant_collection,
                points_selector=models.FilterSelector(
                    filter=models.Filter(
                        must=[
                            models.FieldCondition(
                                key="document_id",
                                match=models.MatchValue(value=document_id)
                            )
                        ]
                    )
                )
            )
            
            # Delete from MongoDB
            await self.mongo_db[DOCUMENTS_COLLECTION].delete_one(
                {"document_id": document_id}
            )
            
            logger.info(f"Successfully deleted document: {document_id}")
            return {"status": "success", "document_id": document_id}
            
        except Exception as e:
            logger.error(f"Error deleting document {document_id}: {e}")
            return {"status": "error", "message": str(e)}
    
    async def get_collection_stats(self) -> Dict[str, Any]:
        """Get statistics about the indexed collection."""
        try:
            # Qdrant collection info
            collection_info = self.qdrant_client.get_collection(settings.qdrant_collection)
            
            # MongoDB document count
            doc_count = await self.mongo_db[DOCUMENTS_COLLECTION].count_documents({})
            
            return {
                "collection_name": settings.qdrant_collection,
                "vector_count": collection_info.points_count,
                "document_count": doc_count,
                "vector_dimension": VECTOR_DIMENSION,
                "status": "healthy"
            }
            
        except Exception as e:
            logger.error(f"Error getting collection stats: {e}")
            return {"status": "error", "message": str(e)}
    
    def close(self):
        """Close all client connections."""
        try:
            self.mongo_client.close()
            logger.info("All connections closed")
        except Exception as e:
            logger.error(f"Error closing connections: {e}")
