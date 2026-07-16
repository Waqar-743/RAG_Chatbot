"""
Tests for RAG Retrieval Module.
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from rag.retrieval import RAGRetriever


class TestRAGRetriever:
    """Tests for RAGRetriever class."""
    
    @pytest.fixture
    def mock_retriever(self):
        """Create a mocked RAGRetriever."""
        with patch('rag.retrieval.get_qdrant_client') as mock_qdrant, \
             patch('rag.retrieval.get_mongo', return_value=(None, None)), \
             patch('rag.retrieval.AsyncOpenAI') as mock_openai:
            
            # Mock Qdrant
            mock_qdrant_instance = MagicMock()
            mock_qdrant.return_value = mock_qdrant_instance
            
            # Mock OpenAI
            mock_openai_instance = MagicMock()
            mock_openai.return_value = mock_openai_instance
            
            retriever = RAGRetriever()
            retriever.openai_client = mock_openai_instance
            retriever.qdrant_client = mock_qdrant_instance
            
            yield retriever
    
    @pytest.mark.asyncio
    async def test_generate_query_embedding(self, mock_retriever):
        """Test query embedding generation."""
        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=[0.1] * 1536)]
        mock_retriever.openai_client.embeddings.create = AsyncMock(return_value=mock_response)
        
        embedding = await mock_retriever.generate_query_embedding("test query")
        
        assert len(embedding) == 1536
    
    @pytest.mark.asyncio
    async def test_retrieve_no_results(self, mock_retriever):
        """Test retrieval when no documents match."""
        # Mock embedding
        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=[0.1] * 1536)]
        mock_retriever.openai_client.embeddings.create = AsyncMock(return_value=mock_response)
        
        # Mock Qdrant search returning empty
        mock_retriever.qdrant_client.search.return_value = []
        
        results = await mock_retriever.retrieve_relevant_documents("test query")
        
        assert results == []
    
    @pytest.mark.asyncio
    async def test_retrieve_with_results(self, mock_retriever):
        """Test retrieval with matching documents."""
        # Mock embedding
        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=[0.1] * 1536)]
        mock_retriever.openai_client.embeddings.create = AsyncMock(return_value=mock_response)
        
        # Mock Qdrant search
        mock_result = MagicMock()
        mock_result.payload = {
            "text": "Test document content",
            "source": "test_source",
            "url": "http://example.com",
            "document_id": "doc123",
            "chunk_index": 0,
            "metadata": {}
        }
        mock_result.score = 0.95
        mock_retriever.qdrant_client.search.return_value = [mock_result]
        
        results = await mock_retriever.retrieve_relevant_documents("test query")
        
        assert len(results) == 1
        assert results[0]["source"] == "test_source"
        assert results[0]["score"] == 0.95
    
    @pytest.mark.asyncio
    async def test_generate_response(self, mock_retriever):
        """Test LLM response generation."""
        mock_response = MagicMock()
        mock_response.choices = [MagicMock(message=MagicMock(content="Test answer"))]
        mock_retriever.openai_client.chat.completions.create = AsyncMock(return_value=mock_response)
        
        answer = await mock_retriever.generate_response(
            query="What is this?",
            context="This is test content."
        )
        
        assert answer == "Test answer"
    
    @pytest.mark.asyncio
    async def test_query_pipeline_success(self, mock_retriever):
        """Test complete query pipeline."""
        # Mock embedding
        mock_embed_response = MagicMock()
        mock_embed_response.data = [MagicMock(embedding=[0.1] * 1536)]
        mock_retriever.openai_client.embeddings.create = AsyncMock(return_value=mock_embed_response)
        
        # Mock Qdrant search
        mock_search_result = MagicMock()
        mock_search_result.payload = {
            "text": "Relevant content",
            "source": "source1",
            "url": "http://example.com",
            "document_id": "doc1",
            "chunk_index": 0,
            "metadata": {}
        }
        mock_search_result.score = 0.9
        mock_retriever.qdrant_client.search.return_value = [mock_search_result]
        
        # Mock LLM response
        mock_llm_response = MagicMock()
        mock_llm_response.choices = [MagicMock(message=MagicMock(content="The answer is..."))]
        mock_retriever.openai_client.chat.completions.create = AsyncMock(return_value=mock_llm_response)
        
        # Mock MongoDB
        mock_retriever.mongo_db = MagicMock()
        mock_retriever.mongo_db.__getitem__ = MagicMock(return_value=MagicMock(insert_one=AsyncMock()))
        
        result = await mock_retriever.query("What is this?")
        
        assert result["status"] == "success"
        assert "answer" in result
        assert result["answer"] == "The answer is..."
        assert len(result["sources"]) > 0
    
    @pytest.mark.asyncio
    async def test_query_pipeline_no_results(self, mock_retriever):
        """Test query pipeline with no matching documents."""
        # Mock embedding
        mock_response = MagicMock()
        mock_response.data = [MagicMock(embedding=[0.1] * 1536)]
        mock_retriever.openai_client.embeddings.create = AsyncMock(return_value=mock_response)
        
        # Mock Qdrant returning no results
        mock_retriever.qdrant_client.search.return_value = []
        
        # Mock MongoDB
        mock_retriever.mongo_db = MagicMock()
        mock_retriever.mongo_db.__getitem__ = MagicMock(return_value=MagicMock(insert_one=AsyncMock()))
        
        result = await mock_retriever.query("Unknown topic")
        
        assert result["status"] == "no_results"
        assert result["sources"] == []
