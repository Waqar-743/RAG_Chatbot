"""
Logging Configuration for RAG Chatbot.
Sets up structured logging with both console and file handlers.
"""

import logging
import sys
from pathlib import Path
from datetime import datetime
from typing import Optional


def setup_logging(
    log_level: str = "INFO",
    log_file: Optional[str] = None,
    app_name: str = "rag-chatbot"
) -> logging.Logger:
    """
    Set up application logging.
    
    Args:
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_file: Optional path to log file
        app_name: Application name for the logger
        
    Returns:
        Configured logger instance
    """
    # Create logger
    logger = logging.getLogger(app_name)
    logger.setLevel(getattr(logging, log_level.upper()))

    # Prevent duplicate handlers
    if logger.handlers:
        return logger

    # Log format
    log_format = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s:%(funcName)s:%(lineno)d | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    # Console handler (always enabled)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(getattr(logging, log_level.upper()))
    console_handler.setFormatter(log_format)
    logger.addHandler(console_handler)

    # File handler — skipped on read-only filesystems (e.g. Vercel serverless)
    import os
    if not os.environ.get("VERCEL"):
        try:
            if log_file is None:
                logs_dir = Path("logs")
                logs_dir.mkdir(exist_ok=True)
                log_file = logs_dir / f"{app_name}_{datetime.now().strftime('%Y%m%d')}.log"
            file_handler = logging.FileHandler(log_file, encoding="utf-8")
            file_handler.setLevel(logging.DEBUG)
            file_handler.setFormatter(log_format)
            logger.addHandler(file_handler)
        except OSError:
            pass  # silently skip file logging if filesystem is not writable

    return logger


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance for a specific module.
    
    Args:
        name: Module name (typically __name__)
        
    Returns:
        Logger instance
    """
    return logging.getLogger(f"rag-chatbot.{name}")


# Initialize default logger
logger = setup_logging()
