"""
Utility Functions for RAG Chatbot.
Helper functions for text processing, file handling, and common operations.
"""

import re
import hashlib
from typing import List, Dict, Any, Optional
from pathlib import Path
import asyncio
from datetime import datetime
import uuid
import io
import httpx
from bs4 import BeautifulSoup

# Optional dependencies for file extraction
try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

try:
    import docx2txt
except ImportError:
    docx2txt = None


def generate_document_id(source: str, content: str) -> str:
    """
    Generate a unique document ID based on source and content.
    
    Args:
        source: Document source identifier
        content: Document content
        
    Returns:
        Unique hash-based ID
    """
    combined = f"{source}:{content[:500]}"
    return hashlib.md5(combined.encode()).hexdigest()


def generate_chunk_id(document_id: str, chunk_index: int) -> str:
    """
    Generate a unique chunk ID.
    
    Args:
        document_id: Parent document ID
        chunk_index: Index of the chunk within the document
        
    Returns:
        Unique chunk ID
    """
    return f"{document_id}_chunk_{chunk_index}"


def generate_uuid() -> str:
    """Generate a UUID string."""
    return str(uuid.uuid4())


def _ordered_breaks(separator: str) -> List[str]:
    """Return preferred chunk boundaries, preserving caller preference first."""
    defaults = ["\n\n", "\n", ". ", "? ", "! ", "; ", ": ", ", ", " "]
    breaks = [separator] if separator else []
    for item in defaults:
        if item and item not in breaks:
            breaks.append(item)
    return breaks


def _trim_bounds(text: str, start: int, end: int) -> tuple[int, int]:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return start, end


def _choose_chunk_end(
    text: str,
    start: int,
    max_end: int,
    min_end: int,
    breaks: List[str],
) -> int:
    if max_end >= len(text):
        return len(text)

    window = text[start:max_end]
    for boundary in breaks:
        idx = window.rfind(boundary)
        if idx == -1:
            continue
        end = start + idx + len(boundary)
        if end >= min_end:
            return end

    return max_end


def _choose_next_start(text: str, previous_start: int, previous_end: int, overlap: int) -> int:
    if overlap <= 0:
        return previous_end

    candidate = max(previous_start + 1, previous_end - overlap)

    # Avoid beginning the next chunk halfway through a word when a nearby
    # boundary exists inside the intended overlap window.
    while (
        candidate < previous_end
        and candidate > 0
        and not text[candidate].isspace()
        and not text[candidate - 1].isspace()
    ):
        candidate += 1

    while candidate < previous_end and text[candidate].isspace():
        candidate += 1

    return min(candidate, previous_end)


def chunk_text(
    text: str,
    chunk_size: int = 512,
    overlap: int = 50,
    separator: str = "\n"
) -> List[Dict[str, Any]]:
    """
    Split text into overlapping, retrieval-friendly chunks with metadata.

    The splitter prefers paragraph and sentence boundaries, clamps unsafe
    overlap values, and guarantees forward progress even on long unbroken text.
    Positions are offsets into the cleaned text returned by clean_text().
    """
    if not text or not text.strip():
        return []

    text = clean_text(text)
    if not text:
        return []

    chunk_size = max(1, int(chunk_size))
    overlap = max(0, int(overlap))
    if overlap >= chunk_size:
        overlap = max(0, chunk_size // 5)
    else:
        overlap = min(overlap, chunk_size // 2)

    if len(text) <= chunk_size:
        return [{
            "text": text,
            "chunk_index": 0,
            "start_char": 0,
            "end_char": len(text)
        }]

    chunks = []
    start = 0
    chunk_index = 0
    breaks = _ordered_breaks(separator)
    min_chunk_length = max(1, chunk_size // 2)

    while start < len(text):
        max_end = min(start + chunk_size, len(text))
        min_end = min(len(text), start + min_chunk_length)
        end = _choose_chunk_end(text, start, max_end, min_end, breaks)
        chunk_start, chunk_end = _trim_bounds(text, start, end)

        if chunk_start < chunk_end:
            chunks.append({
                "text": text[chunk_start:chunk_end],
                "chunk_index": chunk_index,
                "start_char": chunk_start,
                "end_char": chunk_end
            })
            chunk_index += 1

        if end >= len(text):
            break

        next_start = _choose_next_start(text, start, end, overlap)
        if next_start <= start:
            next_start = min(len(text), start + max(1, chunk_size - overlap))
        start = next_start

    return chunks


def clean_text(text: str) -> str:
    """
    Clean and normalize text.
    
    Args:
        text: Raw text input
        
    Returns:
        Cleaned text
    """
    if not text:
        return ""
    
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r'[^\S\n]+', ' ', text)
    text = re.sub(r' *\n *', '\n', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r'[^\w\s.,!?;:\'"()\-\n]', '', text)

    return text.strip()


def extract_text_from_file(file_path: Path) -> Optional[str]:
    """
    Extract text content from various file types.
    
    Args:
        file_path: Path to the file
        
    Returns:
        Extracted text content or None if unsupported
    """
    suffix = file_path.suffix.lower()
    
    try:
        if suffix == ".txt" or suffix == ".md":
            return file_path.read_text(encoding="utf-8")
        
        elif suffix == ".pdf":
            return extract_pdf_text(file_path)
        
        elif suffix == ".docx":
            return extract_docx_text(file_path)
        
        else:
            return None
            
    except Exception as e:
        print(f"Error extracting text from {file_path}: {e}")
        return None


def extract_pdf_text(file_path: Path) -> str:
    """Extract text from PDF file."""
    try:
        from pypdf import PdfReader
        
        reader = PdfReader(str(file_path))
        text_parts = []
        
        for page in reader.pages:
            text = page.extract_text()
            if text:
                text_parts.append(text)
        
        return "\n\n".join(text_parts)
    except ImportError:
        raise ImportError("pypdf is required for PDF processing. Install with: pip install pypdf")


def extract_docx_text(file_path: Path) -> str:
    """Extract text from DOCX file."""
    try:
        from docx import Document
        
        doc = Document(str(file_path))
        text_parts = []
        
        for paragraph in doc.paragraphs:
            if paragraph.text.strip():
                text_parts.append(paragraph.text)
        
        return "\n\n".join(text_parts)
    except ImportError:
        raise ImportError("python-docx is required for DOCX processing. Install with: pip install python-docx")


def format_sources_for_response(sources: List[Dict]) -> str:
    """
    Format source documents for display in response.
    
    Args:
        sources: List of source document dictionaries
        
    Returns:
        Formatted string of sources
    """
    if not sources:
        return "No sources available."
    
    formatted = []
    for i, source in enumerate(sources, 1):
        source_name = source.get("source", "Unknown")
        score = source.get("score", 0)
        text_preview = source.get("text", "")[:150]
        
        formatted.append(f"[{i}] {source_name} (Score: {score:.2f})\n    {text_preview}...")
    
    return "\n".join(formatted)


def truncate_text(text: str, max_length: int = 500, suffix: str = "...") -> str:
    """
    Truncate text to a maximum length.
    
    Args:
        text: Text to truncate
        max_length: Maximum length
        suffix: Suffix to add when truncated
        
    Returns:
        Truncated text
    """
    if len(text) <= max_length:
        return text
    return text[:max_length - len(suffix)] + suffix


def calculate_token_estimate(text: str) -> int:
    """
    Estimate token count (rough approximation).
    
    Args:
        text: Text to estimate
        
    Returns:
        Estimated token count
    """
    # Rough estimate: ~4 characters per token for English
    return len(text) // 4


def validate_api_key(api_key: str) -> bool:
    """
    Basic validation of API key format.
    
    Args:
        api_key: API key to validate
        
    Returns:
        True if valid format
    """
    if not api_key or len(api_key) < 10:
        return False
    return True


def get_timestamp() -> str:
    """Get current UTC timestamp in ISO format."""
    return datetime.utcnow().isoformat()


def safe_dict_get(d: Dict, *keys, default=None):
    """
    Safely get nested dictionary values.
    
    Args:
        d: Dictionary to search
        *keys: Keys to traverse
        default: Default value if not found
        
    Returns:
        Value at nested key or default
    """
    for key in keys:
        if isinstance(d, dict):
            d = d.get(key, default)
        else:
            return default
    return d


async def retry_async(
    func,
    max_retries: int = 3,
    delay: float = 1.0,
    backoff: float = 2.0,
    exceptions: tuple = (Exception,)
):
    """
    Retry an async function with exponential backoff.
    
    Args:
        func: Async function to retry
        max_retries: Maximum number of retries
        delay: Initial delay between retries
        backoff: Backoff multiplier
        exceptions: Tuple of exceptions to catch
        
    Returns:
        Function result
        
    Raises:
        Last exception if all retries fail
    """
    last_exception = None
    current_delay = delay
    
    for attempt in range(max_retries + 1):
        try:
            return await func()
        except exceptions as e:
            last_exception = e
            if attempt == max_retries:
                break
            
            await asyncio.sleep(current_delay)
            current_delay *= backoff
            
    raise last_exception


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract text from PDF file bytes."""
    if not PdfReader:
        raise ImportError("pypdf library not installed")
    
    try:
        reader = PdfReader(io.BytesIO(file_bytes))
        text = ""
        for page in reader.pages:
            content = page.extract_text()
            if content:
                text += content + "\n"
        return text.strip()
    except Exception as e:
        raise ValueError(f"Failed to extract text from PDF: {str(e)}")


def extract_text_from_docx(file_bytes: bytes) -> str:
    """Extract text from DOCX file bytes."""
    if not docx2txt:
        raise ImportError("docx2txt library not installed")
    
    try:
        # docx2txt takes a file path or file-like object
        return docx2txt.process(io.BytesIO(file_bytes)).strip()
    except Exception as e:
        raise ValueError(f"Failed to extract text from DOCX: {str(e)}")


async def extract_text_from_url(url: str) -> str:
    """
    Fetch a URL and extract clean text content from it.
    
    Args:
        url: URL to fetch
        
    Returns:
        Extracted text content
    """
    async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            }
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            
            # Use BeautifulSoup to parse HTML and extract text
            soup = BeautifulSoup(response.text, 'html.parser')
            
            # Remove script and style elements
            for script_or_style in soup(["script", "style", "nav", "header", "footer", "aside"]):
                script_or_style.decompose()
            
            # Get text
            text = soup.get_text(separator=' ')
            
            # Clean up whitespace
            lines = (line.strip() for line in text.splitlines())
            chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
            text = '\n'.join(chunk for chunk in chunks if chunk)
            
            return text.strip()
        except Exception as e:
            raise ValueError(f"Failed to extract text from URL {url}: {str(e)}")
