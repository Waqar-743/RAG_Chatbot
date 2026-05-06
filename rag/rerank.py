"""
Maximal Marginal Relevance (MMR) reranking.

Vector search alone often returns near-duplicate chunks (same paragraph re-embedded
from overlapping windows). MMR re-orders results to balance relevance against
diversity, so the LLM sees distinct evidence rather than the same fact restated.

Reference: Carbonell & Goldstein (1998).
"""

from __future__ import annotations

from typing import List, Sequence

import numpy as np


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity between two 1-D vectors. Returns 0.0 for zero vectors."""
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def mmr_rerank(
    query_embedding: Sequence[float],
    candidate_embeddings: Sequence[Sequence[float]],
    candidate_scores: Sequence[float],
    *,
    top_k: int,
    lambda_mult: float = 0.6,
) -> List[int]:
    """
    Pick `top_k` indices from the candidates using MMR.

    Args:
        query_embedding:      The query vector.
        candidate_embeddings: Candidate vectors aligned with `candidate_scores`.
        candidate_scores:     Original similarity scores from the vector store
                              (used as the relevance term — saves a recomputation).
        top_k:                Number of candidates to return.
        lambda_mult:          1.0 = pure relevance, 0.0 = pure diversity.

    Returns:
        Indices into the candidate arrays, in selected order.
    """
    if not candidate_embeddings:
        return []

    if top_k >= len(candidate_embeddings):
        # Nothing to prune — preserve original ranking.
        return list(range(len(candidate_embeddings)))

    cands = np.asarray(candidate_embeddings, dtype=np.float32)
    scores = np.asarray(candidate_scores, dtype=np.float32)

    # Pre-compute pairwise similarities lazily on demand to keep memory low for large N.
    selected: List[int] = []
    remaining = set(range(len(cands)))

    # Seed with the most relevant candidate.
    first = int(np.argmax(scores))
    selected.append(first)
    remaining.discard(first)

    while len(selected) < top_k and remaining:
        best_idx = -1
        best_score = -float("inf")

        selected_vecs = cands[selected]

        for i in remaining:
            relevance = float(scores[i])
            # Max similarity to anything already picked → the diversity penalty.
            sims = [_cosine(cands[i], v) for v in selected_vecs]
            redundancy = max(sims) if sims else 0.0
            mmr = lambda_mult * relevance - (1.0 - lambda_mult) * redundancy
            if mmr > best_score:
                best_score = mmr
                best_idx = i

        if best_idx == -1:
            break
        selected.append(best_idx)
        remaining.discard(best_idx)

    return selected
