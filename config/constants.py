"""
Application Constants.
Static values that don't change based on environment.
"""

# ===========================================
# Vector Configuration
# ===========================================
VECTOR_DIMENSION = 1536  # text-embedding-3-small dimension
VECTOR_METRIC = "Cosine"

# ===========================================
# Response Configuration
# ===========================================
MAX_SOURCES_RETURNED = 5
MIN_SIMILARITY_SCORE = 0.5
DEFAULT_NO_ANSWER = "I don't have enough information in the indexed documents to answer that."

# ===========================================
# Rate Limiting
# ===========================================
RATE_LIMIT_REQUESTS = 100
RATE_LIMIT_PERIOD = 3600  # 1 hour in seconds

# ===========================================
# Timeouts (in seconds)
# ===========================================
REQUEST_TIMEOUT = 30
EMBEDDING_TIMEOUT = 30
LLM_TIMEOUT = 60
MONGODB_TIMEOUT = 10000  # milliseconds

# ===========================================
# File Processing
# ===========================================
SUPPORTED_FILE_TYPES = [".txt", ".pdf", ".docx", ".md"]
MAX_FILE_SIZE_MB = 10
MAX_CONTENT_LENGTH = 100000  # characters

# ===========================================
# System Prompts
# ===========================================
SYSTEM_PROMPT = """You are Ragnarok, a precise retrieval-grounded assistant.

CORE RULES — non-negotiable:
1. Use ONLY the supplied CONTEXT. If the context doesn't cover the question, reply with exactly: \
"I don't have enough information in the indexed documents to answer that."
2. Never invent facts, names, numbers, dates, or quotes. If unsure, say so.
3. Cite sources inline using their bracketed labels, e.g. [Source: handbook_2024]. \
Cite once per claim, not after every sentence.
4. Resolve conflicts between sources by surfacing both positions and naming each source.
5. Prefer concision. Lead with the answer, then justify in 2-4 sentences. Use bullets only when listing.
6. If the user asks about your capabilities, identity, or the system, answer briefly without inventing features.

Tone: clear, technical, no filler, no apologies, no hedging beyond what the context warrants."""

RAG_PROMPT_TEMPLATE = """Answer the question using ONLY the context below. Cite sources with their [Source: ...] labels.

CONTEXT:
{context}

QUESTION: {question}

If the context does not contain enough information to answer, reply exactly:
"I don't have enough information in the indexed documents to answer that."
"""

# HyDE — generate a hypothetical short answer first, embed THAT instead of the raw query.
# Boosts recall on abstract / paraphrase-heavy questions.
HYDE_PROMPT_TEMPLATE = """Write a single concise paragraph (3-5 sentences) that would plausibly answer this question, \
as if you had access to the relevant document. Do not say you don't know — just write the kind of passage \
that would contain the answer. Output the paragraph only, no preface.

QUESTION: {question}

PARAGRAPH:"""

# ===========================================
# Collection Names (MongoDB)
# ===========================================
DOCUMENTS_COLLECTION = "documents"
CHAT_HISTORY_COLLECTION = "chat_history"
METADATA_COLLECTION = "metadata"

# ===========================================
# API Response Messages
# ===========================================
MSG_SUCCESS = "Operation completed successfully"
MSG_ERROR_GENERIC = "An error occurred while processing your request"
MSG_ERROR_NO_DOCS = "No relevant documents found"
MSG_ERROR_INDEXING = "Error occurred during document indexing"
MSG_ERROR_RETRIEVAL = "Error occurred during document retrieval"
