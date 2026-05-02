"""
RAGScope vector store wrapper.

Each pipeline Config gets its own Chroma collection (named "config_{id}")
because each config pins exactly one embedding model — and therefore
exactly one vector dimension. Chroma enforces "one dimension per
collection", and even if it didn't, mixing two models' vectors in one
bucket wouldn't be meaningful: their geometric spaces aren't comparable.

We use Chroma's persistent client, so the on-disk store at ./chroma_db/
survives uvicorn restarts. The directory is gitignored.

Distance metric: cosine. Sentence embedders encode meaning in the
*direction* of their vectors, so cosine similarity (norm-invariant) is
the canonical choice. Chroma's default is L2 (Euclidean), which would
over-weight magnitude — sentences with the same meaning but different
lengths would score apart for the wrong reason.

This module is the only place the rest of the codebase touches Chroma.
Routes and core orchestration call into here; they never instantiate
clients or manage collections directly.

Week 3 surface:
- `get_collection(config_id)` — get-or-create the per-config collection.
- `upsert_chunks(config_id, chunks, embeddings)` — write N rows in one call.

Week 4 will add:
- `query(config_id, query_embedding, top_k)` — for the retriever.
"""

from pathlib import Path
from typing import TYPE_CHECKING

import chromadb
from chromadb import Collection

if TYPE_CHECKING:
    from backend.db.models import Chunk


# ---------------------------------------------------------------------------
# Persistent client. Lazy-initialised at module level — created once per
# Python process, then reused for every collection access. Same lifecycle
# pattern as the embedder cache: module imports once, the global lives
# until the process exits.
# ---------------------------------------------------------------------------
_CHROMA_DIR = Path("./chroma_db")
_client = None


def _get_client():
    """Return the process-wide Chroma client, creating it on first call."""
    global _client
    if _client is None:
        # mkdir is harmless if the directory already exists (parents=True,
        # exist_ok=True). PersistentClient itself would create it too, but
        # being explicit keeps the intent obvious.
        _CHROMA_DIR.mkdir(parents=True, exist_ok=True)
        _client = chromadb.PersistentClient(path=str(_CHROMA_DIR))
    return _client


def _collection_name(config_id: int) -> str:
    """Per-config collection name. Stable, so re-runs always hit the same one."""
    return f"config_{config_id}"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_collection(config_id: int) -> Collection:
    """Get-or-create the Chroma collection for `config_id`.

    The collection is configured for cosine distance via the `hnsw:space`
    metadata key. On a brand-new collection this metadata sticks; on an
    existing collection Chroma keeps whatever was set the first time
    around — so changing the metric here later won't retroactively change
    existing collections (you'd need to delete and rebuild them).
    """
    client = _get_client()
    return client.get_or_create_collection(
        name=_collection_name(config_id),
        metadata={"hnsw:space": "cosine"},
    )


def upsert_chunks(
    config_id: int,
    chunks: list["Chunk"],
    embeddings: list[list[float]],
) -> None:
    """Push N (chunk, vector) pairs into the per-config collection.

    Idempotent — re-running with the same chunk ids overwrites in place
    rather than duplicating, because Chroma keys rows on `ids` and we use
    each chunk's SQLite primary key as its Chroma id.

    Each Chroma row stores:
      - id          str(chunk.id)              — round-trips back to SQL
      - embedding   the vector
      - document    chunk.content              — so retrieval can return
                                                 the text without joining
                                                 back to SQLite
      - metadata    {document_id, config_id, chunk_index,
                     start_char, end_char}     — everything the trace UI
                                                 needs to render results

    Args:
        config_id:  Pipeline config whose collection to write into.
        chunks:     Persisted Chunk rows (must have non-None .id).
        embeddings: Vectors aligned 1:1 with `chunks` by index.

    Raises:
        ValueError: If the lengths of `chunks` and `embeddings` differ.
    """
    if not chunks:
        return
    if len(chunks) != len(embeddings):
        raise ValueError(
            f"chunks ({len(chunks)}) and embeddings ({len(embeddings)}) "
            "must have the same length"
        )

    collection = get_collection(config_id)
    collection.upsert(
        ids=[str(c.id) for c in chunks],
        embeddings=embeddings,
        documents=[c.content for c in chunks],
        metadatas=[
            {
                "document_id": c.document_id,
                "config_id": c.config_id,
                "chunk_index": c.chunk_index,
                "start_char": c.start_char,
                "end_char": c.end_char,
            }
            for c in chunks
        ],
    )
