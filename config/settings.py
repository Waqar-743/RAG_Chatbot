"""
Application Settings using Pydantic Settings Management.
Loads configuration from environment variables and .env file.
"""

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # ===========================================
    # OpenRouter API Configuration
    # ===========================================
    openrouter_api_key: str = Field(
        default="",
        description="OpenRouter API key for LLM and embeddings"
    )
    openrouter_base_url: str = Field(
        default="https://openrouter.ai/api/v1",
        description="OpenRouter API base URL"
    )
    
    # ===========================================
    # Qdrant Vector Database Configuration
    # ===========================================
    qdrant_api_key: str = Field(
        default="",
        description="Qdrant Cloud API key"
    )
    qdrant_url: str = Field(
        default="",
        description="Qdrant Cloud URL"
    )
    qdrant_collection: str = Field(
        default="rag_documents",
        description="Name of the Qdrant collection"
    )
    
    # ===========================================
    # MongoDB Configuration
    # ===========================================
    mongo_uri: str = Field(
        default="",
        description="MongoDB connection URI"
    )
    mongo_db_name: str = Field(
        default="rag_db",
        description="MongoDB database name"
    )
    
    # ===========================================
    # Application Configuration
    # ===========================================
    app_host: str = Field(
        default="0.0.0.0",
        description="Application host"
    )
    app_port: int = Field(
        default=8000,
        description="Application port"
    )
    debug: bool = Field(
        default=False,
        description="Debug mode"
    )
    log_level: str = Field(
        default="INFO",
        description="Logging level"
    )
    
    # ===========================================
    # LLM Configuration
    # ===========================================
    llm_model: str = Field(
        default="deepseek/deepseek-chat",
        description="LLM model name for OpenRouter"
    )
    embedding_model: str = Field(
        default="openai/text-embedding-3-small",
        description="Embedding model name for OpenRouter"
    )
    temperature: float = Field(
        default=0.7,
        ge=0.0,
        le=2.0,
        description="LLM temperature"
    )
    max_tokens: int = Field(
        default=2048,
        ge=1,
        description="Maximum tokens for LLM response"
    )
    
    # ===========================================
    # RAG Configuration
    # ===========================================
    top_k: int = Field(
        default=5,
        ge=1,
        le=20,
        description="Number of documents to retrieve"
    )
    similarity_threshold: float = Field(
        default=0.3,
        ge=0.0,
        le=1.0,
        description="Minimum similarity score for retrieval"
    )
    chunk_size: int = Field(
        default=512,
        ge=100,
        le=2000,
        description="Text chunk size for indexing"
    )
    chunk_overlap: int = Field(
        default=50,
        ge=0,
        description="Overlap between text chunks"
    )

    # ===========================================
    # Retrieval Hardening (Pass 2 upgrades)
    # ===========================================
    enable_hyde: bool = Field(
        default=False,
        description="Enable HyDE query rewriting (generate a hypothetical answer to embed). "
                    "Improves recall on abstract questions but adds one LLM call per query.",
    )
    enable_mmr: bool = Field(
        default=True,
        description="Enable Maximal Marginal Relevance reranking for source diversity.",
    )
    mmr_lambda: float = Field(
        default=0.6,
        ge=0.0,
        le=1.0,
        description="MMR trade-off: 1.0 = pure relevance, 0.0 = pure diversity.",
    )
    overfetch_multiplier: int = Field(
        default=3,
        ge=1,
        le=10,
        description="Pull top_k * multiplier from vector store before reranking.",
    )
    hallucination_guard_score: float = Field(
        default=0.35,
        ge=0.0,
        le=1.0,
        description="If the best retrieved chunk scores below this, return the no-answer "
                    "response instead of generating (prevents hallucination on weak matches).",
    )
    embedding_max_retries: int = Field(
        default=4,
        ge=1,
        le=10,
        description="Retry attempts for embedding API calls.",
    )
    llm_max_retries: int = Field(
        default=3,
        ge=1,
        le=10,
        description="Retry attempts for LLM completion calls.",
    )
    embedding_batch_size: int = Field(
        default=64,
        ge=1,
        le=512,
        description="Max chunks per embedding API call when indexing.",
    )

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


# Global settings instance
settings = get_settings()
