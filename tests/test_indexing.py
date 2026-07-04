"""
Tests for RAG Indexing Module.
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from rag.indexing import RAGIndexer
from rag.utils import chunk_text, clean_text, generate_document_id


class TestChunkText:
    """Tests for text chunking functionality."""
    
    def test_chunk_short_text(self):
        """Short text should return single chunk."""
        text = "This is a short text."
        chunks = chunk_text(text, chunk_size=100, overlap=10)
        assert len(chunks) == 1
        assert chunks[0]["text"] == text
    
    def test_chunk_long_text(self):
        """Long text should be split into multiple chunks."""
        text = "A" * 1000
        chunks = chunk_text(text, chunk_size=200, overlap=20)
        assert len(chunks) > 1
    
    def test_chunk_with_overlap(self):
        """Chunks should have overlapping content."""
        text = "Word " * 100  # 500 characters
        chunks = chunk_text(text, chunk_size=100, overlap=20)
        
        # At least 2 chunks
        assert len(chunks) >= 2
    
    def test_chunk_empty_text(self):
        """Empty text should return empty list."""
        chunks = chunk_text("", chunk_size=100, overlap=10)
        assert chunks == []
    
    def test_chunk_metadata(self):
        """Chunks should include position metadata."""
        text = "Hello world. This is a test."
        chunks = chunk_text(text, chunk_size=100, overlap=10)
        
        assert "chunk_index" in chunks[0]
        assert "start_char" in chunks[0]
        assert "end_char" in chunks[0]

    def test_chunk_metadata_matches_cleaned_text_slice(self):
        """Chunk offsets should point to the exact cleaned text slice."""
        text = "Intro paragraph.\n\nSecond paragraph with more detail. " * 8
        cleaned = clean_text(text)
        chunks = chunk_text(text, chunk_size=90, overlap=15)

        assert len(chunks) > 1
        for idx, chunk in enumerate(chunks):
            assert chunk["chunk_index"] == idx
            assert cleaned[chunk["start_char"]:chunk["end_char"]] == chunk["text"]
            assert chunk["text"] == chunk["text"].strip()

    def test_chunk_overlap_is_clamped_and_progresses(self):
        """Unsafe overlap values should not create an infinite loop."""
        text = "word " * 120
        chunks = chunk_text(text, chunk_size=80, overlap=80)

        assert len(chunks) > 1
        starts = [chunk["start_char"] for chunk in chunks]
        assert starts == sorted(starts)
        assert len(starts) == len(set(starts))

    def test_chunk_prefers_natural_boundaries(self):
        """Chunks should avoid leading/trailing whitespace around natural breaks."""
        text = "Alpha sentence one. Alpha sentence two.\n\nBeta sentence one. Beta sentence two."
        chunks = chunk_text(text, chunk_size=48, overlap=0)

        assert len(chunks) >= 2
        assert all(chunk["text"] == chunk["text"].strip() for chunk in chunks)
        assert chunks[0]["text"].endswith(".")


class TestCleanText:
    """Tests for text cleaning functionality."""
    
    def test_clean_whitespace(self):
        """Should normalize whitespace."""
        text = "Hello    world\n\n\n\ntest"
        cleaned = clean_text(text)
        assert "    " not in cleaned
    
    def test_clean_empty(self):
        """Should handle empty string."""
        assert clean_text("") == ""
        assert clean_text(None) == ""
    
    def test_preserve_punctuation(self):
        """Should preserve punctuation."""
        text = "Hello, world! How are you?"
        cleaned = clean_text(text)
        assert "," in cleaned
        assert "!" in cleaned
        assert "?" in cleaned


class TestGenerateDocumentId:
    """Tests for document ID generation."""
    
    def test_consistent_id(self):
        """Same input should produce same ID."""
        id1 = generate_document_id("source1", "content here")
        id2 = generate_document_id("source1", "content here")
        assert id1 == id2
    
    def test_different_sources(self):
        """Different sources should produce different IDs."""
        id1 = generate_document_id("source1", "content")
        id2 = generate_document_id("source2", "content")
        assert id1 != id2


class TestRAGIndexer:
    """Tests for RAGIndexer class."""
    
    @pytest.fixture
    def mock_indexer(self):
        """Create a mocked RAGIndexer."""
        with patch('rag.indexing.QdrantClient') as mock_qdrant, \
             patch('rag.indexing.AsyncIOMotorClient') as mock_mongo, \
             patch('rag.indexing.AsyncOpenAI') as mock_openai:
            
            # Mock Qdrant
            mock_qdrant_instance = MagicMock()
            mock_qdrant_instance.get_collections.return_value = MagicMock(collections=[])
            mock_qdrant.return_value = mock_qdrant_instance
            
            # Mock MongoDB
            mock_mongo_instance = MagicMock()
            mock_mongo.return_value = mock_mongo_instance
            
            # Mock OpenAI
            mock_openai_instance = MagicMock()
            mock_openai.return_value = mock_openai_instance
            
            indexer = RAGIndexer()
            indexer.openai_client = mock_openai_instance
            
            yield indexer
    
    @pytest.mark.asyncio
    async def test_generate_embeddings(self, mock_indexer):
        """Test embedding generation."""
        # Mock the embedding response
        mock_response = MagicMock()
        mock_response.data = [
            MagicMock(embedding=[0.1] * 1536),
            MagicMock(embedding=[0.2] * 1536)
        ]
        mock_indexer.openai_client.embeddings.create = AsyncMock(return_value=mock_response)
        
        texts = ["Hello world", "Test text"]
        embeddings = await mock_indexer.generate_embeddings(texts)
        
        assert len(embeddings) == 2
        assert len(embeddings[0]) == 1536
    
    @pytest.mark.asyncio
    async def test_index_empty_document(self, mock_indexer):
        """Test indexing with empty content."""
        doc = {"source": "test", "content": ""}
        result = await mock_indexer.index_document(doc)
        
        assert result["status"] == "error"
        assert "Empty" in result["message"]
