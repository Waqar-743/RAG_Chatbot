"""
RAG Chatbot - Main Application Entry Point.
FastAPI application with CORS support for frontend integration.
"""

import os
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from api.routes import router, get_indexer, get_retriever
from config.settings import settings
from config.logging_config import setup_logging, get_logger

# Setup logging
setup_logging(log_level=settings.log_level)
logger = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator:
    """
    Application lifespan manager.
    Handles startup and shutdown events.
    """
    # Startup
    logger.info("=" * 50)
    logger.info("RAG Chatbot API Starting...")
    logger.info(f"Debug Mode: {settings.debug}")
    logger.info(f"LLM Model: {settings.llm_model}")
    logger.info(f"Embedding Model: {settings.embedding_model}")
    logger.info("=" * 50)
    
    # Initialize components on startup (optional - can be lazy loaded)
    try:
        indexer = get_indexer()
        retriever = get_retriever()
        logger.info("RAG components initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize RAG components: {e}")
        # Don't raise - let the app start and handle errors per-request
    
    yield
    
    # Shutdown
    logger.info("RAG Chatbot API Shutting down...")
    try:
        get_indexer().close()
        get_retriever().close()
    except Exception as e:
        logger.error(f"Error during shutdown: {e}")


# Create FastAPI application
app = FastAPI(
    title="RAG Chatbot API",
    description="""
    A Production-Ready Retrieval-Augmented Generation (RAG) Chatbot API.
    
    ## Features
    - 🔍 Semantic document search
    - 🧠 AI-powered question answering
    - 📚 Multi-document support
    - 📊 Source citations
    - 💬 Chat history
    
    ## Endpoints
    - **Query**: Ask questions and get AI-powered answers
    - **Search**: Find similar documents
    - **Index**: Add documents to the knowledge base
    - **History**: Retrieve chat history
    """,
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc"
)

# Configure CORS — allow Vercel frontend, GitHub Pages, and local dev
_BASE_ORIGINS = [
    "https://waqar-743.github.io",          # GitHub Pages (legacy)
    "http://localhost:3000",                  # local Vite dev server
    "http://localhost:5173",
]

# Accept extra origins from env var (comma-separated) — add your Vercel
# frontend URL here without redeploying: CORS_ORIGINS=https://rag-chatbot.vercel.app
_extra = os.environ.get("CORS_ORIGINS", "")
_ALLOWED_ORIGINS = _BASE_ORIGINS + [o.strip() for o in _extra.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(router, prefix="/api/v1")


# Root endpoint
@app.get("/", tags=["Root"])
async def root():
    """Root endpoint with API information."""
    return {
        "name": "RAG Chatbot API",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
        "health": "/api/v1/health"
    }


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.app_host,
        port=settings.app_port,
        reload=settings.debug,
        log_level=settings.log_level.lower()
    )
