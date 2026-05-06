/**
 * API Service for RAG Chatbot Backend
 * Handles all HTTP requests to the FastAPI backend
 */

import axios, { AxiosInstance, AxiosError } from 'axios';

// API Base URL — uses Vite proxy in dev; in prod, set VITE_API_URL to your backend root
// (e.g. https://ragnarok-api.onrender.com). The "/api/v1" suffix is appended automatically.
const RAW_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');
const API_BASE_URL = RAW_BASE ? `${RAW_BASE}/api/v1` : '/api/v1';

// Create axios instance
const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 60000, // 60 seconds for LLM responses
});

// Types
export interface QueryRequest {
  query: string;
  session_id?: string;
  top_k?: number;
  filter_source?: string;
}

export interface Source {
  source: string;
  url: string;
  text: string;
  score: number;
  chunk_index: number;
}

export interface QueryResponse {
  answer: string;
  sources: Source[];
  query: string;
  documents_retrieved: number;
  processing_time_ms: number;
  status: string;
}

export interface DocumentInput {
  source: string;
  content: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface IndexRequest {
  documents: DocumentInput[];
}

export interface IndexResult {
  status: string;
  source: string;
  document_id?: string;
  chunks_indexed?: number;
  message?: string;
}

export interface IndexResponse {
  total: number;
  successful: number;
  failed: number;
  total_chunks: number;
  details: IndexResult[];
}

export interface SearchResult {
  text: string;
  source: string;
  url: string;
  score: number;
  document_id: string;
  chunk_index: number;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  total_results: number;
}

export interface CollectionStats {
  collection_name: string;
  vector_count: number;
  document_count: number;
  vector_dimension: number;
  status: string;
}

export interface HealthResponse {
  status: string;
  version: string;
  timestamp: string;
}

export interface UploadResponse {
  filename: string;
  text: string;
  char_count: number;
  type: string;
}

// Error handler
const handleApiError = (error: AxiosError): never => {
  if (error.response) {
    const data = error.response.data as { detail?: string };
    throw new Error(data.detail || `API Error: ${error.response.status}`);
  } else if (error.request) {
    throw new Error('Network error - please check your connection');
  } else {
    throw new Error(error.message);
  }
};

// API Functions
export const api = {
  /**
   * Health check
   */
  async healthCheck(): Promise<HealthResponse> {
    try {
      const response = await apiClient.get<HealthResponse>('/health');
      return response.data;
    } catch (error) {
      throw handleApiError(error as AxiosError);
    }
  },

  /**
   * Get collection statistics
   */
  async getStats(): Promise<CollectionStats> {
    try {
      const response = await apiClient.get<CollectionStats>('/stats');
      return response.data;
    } catch (error) {
      throw handleApiError(error as AxiosError);
    }
  },

  /**
   * Query the RAG system
   */
  async query(request: QueryRequest): Promise<QueryResponse> {
    try {
      const response = await apiClient.post<QueryResponse>('/query', request);
      return response.data;
    } catch (error) {
      throw handleApiError(error as AxiosError);
    }
  },

  /**
   * Search for similar documents
   */
  async search(query: string, topK: number = 10): Promise<SearchResponse> {
    try {
      const response = await apiClient.post<SearchResponse>('/search', {
        query,
        top_k: topK,
      });
      return response.data;
    } catch (error) {
      throw handleApiError(error as AxiosError);
    }
  },

  /**
   * Upload and extract text from a file
   */
  async uploadFile(file: File): Promise<UploadResponse> {
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await apiClient.post<UploadResponse>('/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error) {
      throw handleApiError(error as AxiosError);
    }
  },

  /**
   * Index documents
   */
  async indexDocuments(documents: DocumentInput[]): Promise<IndexResponse> {
    try {
      const response = await apiClient.post<IndexResponse>('/index', {
        documents,
      });
      return response.data;
    } catch (error) {
      throw handleApiError(error as AxiosError);
    }
  },

  /**
   * Fetch and index a URL
   */
  async indexUrl(url: string): Promise<IndexResponse> {
    try {
      const response = await apiClient.post<IndexResponse>('/index/url', null, {
        params: { url },
      });
      return response.data;
    } catch (error) {
      throw handleApiError(error as AxiosError);
    }
  },

  /**
   * Delete a document
   */
  async deleteDocument(documentId: string): Promise<{ status: string; message: string }> {
    try {
      const response = await apiClient.delete(`/documents/${documentId}`);
      return response.data;
    } catch (error) {
      throw handleApiError(error as AxiosError);
    }
  },

  /**
   * Get chat history
   */
  async getChatHistory(sessionId: string, limit: number = 10) {
    try {
      const response = await apiClient.get(`/history/${sessionId}`, {
        params: { limit },
      });
      return response.data;
    } catch (error) {
      throw handleApiError(error as AxiosError);
    }
  },
};

export default api;
