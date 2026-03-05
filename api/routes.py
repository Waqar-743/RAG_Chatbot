"""
API Routes for RAG Chatbot.
FastAPI endpoints for querying, indexing, and managing documents.
"""

from fastapi import APIRouter, HTTPException, status, BackgroundTasks, File, UploadFile
from typing import Optional, List
from datetime import datetime
import os

from api.models import (
    QueryRequest,
    QueryResponse,
    IndexRequest,
    IndexResponse,
    SearchRequest,
    SearchResponse,
    DeleteDocumentRequest,
    CollectionStats,
    HealthResponse,
    ChatHistoryResponse,
    ErrorResponse
)
from rag.indexing import RAGIndexer
from rag.retrieval import RAGRetriever
from rag.utils import extract_text_from_pdf, extract_text_from_docx, extract_text_from_url
from config.logging_config import get_logger
from config.settings import settings

logger = get_logger(__name__)

router = APIRouter()

# Initialize RAG components (lazy loading)
_indexer: Optional[RAGIndexer] = None
_retriever: Optional[RAGRetriever] = None


def get_indexer() -> RAGIndexer:
    """Get or create RAGIndexer instance."""
    global _indexer
    if _indexer is None:
        _indexer = RAGIndexer()
    return _indexer


def get_retriever() -> RAGRetriever:
    """Get or create RAGRetriever instance."""
    global _retriever
    if _retriever is None:
        _retriever = RAGRetriever()
    return _retriever


# ===========================================
# Health & Status Endpoints
# ===========================================

@router.get(
    "/health",
    response_model=HealthResponse,
    tags=["Health"],
    summary="Health check endpoint"
)
async def health_check():
    """Check if the API is running and healthy."""
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        timestamp=datetime.utcnow().isoformat()
    )


@router.get(
    "/stats",
    response_model=CollectionStats,
    tags=["Health"],
    summary="Get collection statistics"
)
async def get_stats():
    """Get statistics about the indexed document collection."""
    try:
        indexer = get_indexer()
        stats = await indexer.get_collection_stats()
        return CollectionStats(**stats)
    except Exception as e:
        logger.error(f"Error getting stats: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


# ===========================================
# Query Endpoints
# ===========================================

@router.post(
    "/query",
    response_model=QueryResponse,
    tags=["Query"],
    summary="Query the RAG system"
)
async def query_documents(request: QueryRequest):
    """
    Query the RAG system with a question.
    
    This endpoint:
    1. Retrieves relevant documents using semantic search
    2. Generates an answer using the LLM
    3. Returns the answer with source citations
    """
    try:
        logger.info(f"Received query: {request.query[:50]}...")
        
        retriever = get_retriever()
        result = await retriever.query(
            user_query=request.query,
            session_id=request.session_id,
            top_k=request.top_k,
            filter_source=request.filter_source
        )
        
        # Convert to response model
        return QueryResponse(
            answer=result["answer"],
            sources=[
                {
                    "source": s["source"],
                    "url": s["url"],
                    "text": s["text"],
                    "score": s["score"],
                    "chunk_index": s["chunk_index"]
                }
                for s in result.get("sources", [])
            ],
            query=result["query"],
            documents_retrieved=result.get("documents_retrieved", 0),
            processing_time_ms=result["processing_time_ms"],
            status=result["status"]
        )
        
    except Exception as e:
        logger.error(f"Query error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post(
    "/search",
    response_model=SearchResponse,
    tags=["Query"],
    summary="Search for similar documents"
)
async def search_documents(request: SearchRequest):
    """
    Search for documents similar to the query.
    Returns matching document chunks without generating an LLM response.
    """
    try:
        retriever = get_retriever()
        results = await retriever.search_similar_documents(
            query=request.query,
            top_k=request.top_k
        )
        
        return SearchResponse(
            results=results,
            query=request.query,
            total_results=len(results)
        )
        
    except Exception as e:
        logger.error(f"Search error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


# ===========================================
# Indexing Endpoints
# ===========================================

@router.post(
    "/index",
    response_model=IndexResponse,
    tags=["Indexing"],
    summary="Index documents"
)
async def index_documents(request: IndexRequest):
    """
    Index one or more documents into the RAG system.
    
    Documents are:
    1. Chunked into smaller pieces
    2. Converted to embeddings
    3. Stored in the vector database
    """
    try:
        logger.info(f"Indexing {len(request.documents)} documents")
        
        # Convert to dict format
        documents = [doc.model_dump() for doc in request.documents]
        
        indexer = get_indexer()
        result = await indexer.index_documents(documents)
        
        return IndexResponse(
            total=result["total"],
            successful=result["successful"],
            failed=result["failed"],
            total_chunks=result["total_chunks"],
            details=[
                {
                    "status": d["status"],
                    "source": d.get("source", ""),
                    "document_id": d.get("document_id"),
                    "chunks_indexed": d.get("chunks_indexed", 0),
                    "message": d.get("message")
                }
                for d in result["details"]
            ]
        )
        
    except Exception as e:
        logger.error(f"Indexing error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post(
    "/upload",
    tags=["Indexing"],
    summary="Upload and extract text from files"
)
async def upload_file(file: UploadFile = File(...)):
    """
    Upload a PDF or DOCX file and extract its text content.
    Returns the extracted text and file metadata.
    """
    try:
        content_type = file.content_type
        filename = file.filename
        file_extension = os.path.splitext(filename)[1].lower() if filename else ""
        
        # Read file bytes
        file_bytes = await file.read()
        text = ""

        if file_extension == ".pdf" or content_type == "application/pdf":
            logger.info(f"Extracting text from PDF: {filename}")
            text = extract_text_from_pdf(file_bytes)
        elif file_extension == ".docx" or content_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            logger.info(f"Extracting text from DOCX: {filename}")
            text = extract_text_from_docx(file_bytes)
        elif file_extension in [".txt", ".md"] or "text/" in content_type:
            logger.info(f"Reading text file: {filename}")
            text = file_bytes.decode("utf-8")
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported file type: {content_type}. Please upload PDF, DOCX, TXT, or MD."
            )

        if not text:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Empty text extracted from document."
            )

        return {
            "filename": filename,
            "text": text,
            "char_count": len(text),
            "type": file_extension.replace(".", "")
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.post(
    "/index/url",
    tags=["Indexing"],
    summary="Fetch and index a URL"
)
async def index_url(url: str):
    """
    Fetch content from a URL, extract text, and index it.
    """
    try:
        logger.info(f"Indexing URL: {url}")
        
        # 1. Extract text
        text = await extract_text_from_url(url)
        
        if not text or len(text) < 50:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not extract sufficient text from the provided URL."
            )
        
        # 2. Create document input
        doc_input = {
            "source": url,
            "content": text,
            "url": url,
            "metadata": {
                "indexed_via": "web_search_direct",
                "timestamp": datetime.utcnow().isoformat()
            }
        }
        
        # 3. Index
        indexer = get_indexer()
        result = await indexer.index_documents([doc_input])
        
        return result
        
    except Exception as e:
        logger.error(f"URL indexing error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


@router.delete(
    "/documents/{document_id}",
    tags=["Indexing"],
    summary="Delete a document"
)
async def delete_document(document_id: str):
    """Delete a document and its chunks from the system."""
    try:
        indexer = get_indexer()
        result = await indexer.delete_document(document_id)
        
        if result["status"] == "error":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=result.get("message", "Document not found")
            )
        
        return {"status": "success", "message": f"Document {document_id} deleted"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )


# ===========================================
# Chat History Endpoints
# ===========================================

@router.get(
    "/history/{session_id}",
    response_model=ChatHistoryResponse,
    tags=["History"],
    summary="Get chat history"
)
async def get_chat_history(session_id: str, limit: int = 10):
    """Retrieve chat history for a specific session."""
    try:
        retriever = get_retriever()
        history = await retriever.get_chat_history(session_id, limit)
        
        return ChatHistoryResponse(
            session_id=session_id,
            history=history,
            total_entries=len(history)
        )
        
    except Exception as e:
        logger.error(f"History retrieval error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e)
        )
