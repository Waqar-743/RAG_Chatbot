"""
RAG Chatbot - Main Application Entry Point.
FastAPI application with CORS support for frontend integration.
"""

import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator:
    """
    Application lifespan manager.
    Handles startup and shutdown events.
    NOTE: Kept lightweight for Vercel cold-start performance.
    RAG components use lazy-loading per request.
    """
    yield


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
    "https://waqar-743.github.io",           # GitHub Pages frontend
    "http://localhost:3000",                   # local Vite dev server
    "http://localhost:5173",
    "https://*.vercel.app",                   # any Vercel preview/prod URL
]

# Accept extra origins from env var (comma-separated)
# e.g. CORS_ORIGINS=https://rag-chatbot-frontend.vercel.app
_extra = os.environ.get("CORS_ORIGINS", "")
_ALLOWED_ORIGINS = _BASE_ORIGINS + [o.strip() for o in _extra.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",  # catch all Vercel domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes (lazy — avoids heavy imports at module load time)
from api.routes import router  # noqa: E402
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
    import uvicorn
    from config.settings import settings
    uvicorn.run(
        "main:app",
        host=getattr(settings, "app_host", "0.0.0.0"),
        port=getattr(settings, "app_port", 8000),
        reload=getattr(settings, "debug", False),
        log_level=getattr(settings, "log_level", "INFO").lower()
    )
