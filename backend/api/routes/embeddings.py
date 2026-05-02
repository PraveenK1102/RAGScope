"""
Embeddings API — turn chunks into vectors and persist them.

POST /api/embeddings/{document_id}/{config_id}/build
    For a given (doc, cfg) pair that already has chunks materialised,
    embed every chunk under the config's embedding model, cache the raw
    vector bytes back onto `chunks.embedding`, and upsert them into the
    per-config ChromaDB collection.

    Semantics:
        - 404 if the document or config doesn't exist.
        - 409 if no chunks exist yet (the Chunks tab must be hit first to
          lazy-materialise them).
        - 503 if the chosen backend isn't reachable (Ollama down).
        - Always re-embeds everything for the pair on each call. Safe via
          Chroma's `upsert` + the composite (doc, cfg) chunk identity, so
          repeat calls overwrite cleanly rather than duplicate.
"""

import struct

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.embedder import EmbedderUnavailable, get_embedder
from backend.core.vector_store import upsert_chunks
from backend.db.database import get_db
from backend.db.models import Chunk, Config, Document


router = APIRouter(prefix="/api/embeddings", tags=["embeddings"])


# ---------------------------------------------------------------------------
# Response schema — same Pydantic-on-the-wire pattern as documents/configs/
# chunks. Tells the UI everything it needs to confirm a successful build
# without a follow-up GET.
# ---------------------------------------------------------------------------
class BuildEmbeddingsResponse(BaseModel):
    """Returned after a successful build."""

    document_id: int
    config_id: int
    embedding_model: str
    dimension: int
    chunks_embedded: int
    collection: str  # name of the Chroma collection that was populated


# ---------------------------------------------------------------------------
# Tiny helpers for serialising one vector to/from bytes, for storage in the
# SQLite cache column (`chunks.embedding`). We use 4-byte float32: good
# enough for retrieval scoring, halves storage vs float64. `struct` is
# stdlib so no dep cost.
#
# Layout: <n * 4 bytes>, where n = vector dimension. Decoder infers n
# from len(bytes) // 4 — we don't need to store the dim alongside, since
# the chunk's config tells us which embedding model produced it.
# ---------------------------------------------------------------------------
def _vector_to_bytes(vec: list[float]) -> bytes:
    """Pack a vector into a contiguous float32 byte string."""
    return struct.pack(f"{len(vec)}f", *vec)


def _bytes_to_vector(data: bytes) -> list[float]:
    """Inverse of _vector_to_bytes. Not used in Week 3 — provided for
    Week 4's Chroma-rebuild-from-cache path."""
    n = len(data) // 4
    return list(struct.unpack(f"{n}f", data))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post(
    "/{document_id}/{config_id}/build",
    response_model=BuildEmbeddingsResponse,
    summary="Embed every chunk of a (document, config) pair and upsert into Chroma",
)
def build_embeddings(
    document_id: int,
    config_id: int,
    db: Session = Depends(get_db),
) -> BuildEmbeddingsResponse:
    # 1. Validate the IDs early — 404 before doing any work.
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail=f"Document {document_id} not found",
        )

    config = db.get(Config, config_id)
    if config is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail=f"Config {config_id} not found",
        )

    # 2. Pull materialised chunks for this pair. None present → the user
    #    hasn't viewed chunks in the UI yet (which is what triggers their
    #    creation). Surface that as 409 rather than silently no-op.
    chunks = (
        db.query(Chunk)
        .filter(Chunk.document_id == document_id, Chunk.config_id == config_id)
        .order_by(Chunk.chunk_index)
        .all()
    )
    if not chunks:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                f"No chunks exist for document {document_id} under config {config_id}. "
                "Load them in the Chunks tab first so they're materialised in the DB."
            ),
        )

    # 3. Embed + persist.
    #    EmbedderUnavailable (Ollama down etc.) → 503 with the embedder's
    #    own helpful message; everything else propagates as 500.
    try:
        embedder = get_embedder(config.embedding_model)
    except ValueError as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported embedding model: {config.embedding_model}",
        )

    try:
        vectors = embedder.embed([c.content for c in chunks])

        for chunk, vec in zip(chunks, vectors):
            chunk.embedding = _vector_to_bytes(vec)

        db.commit()
        upsert_chunks(config_id, chunks, vectors)

    except EmbedderUnavailable as e:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        )

    return BuildEmbeddingsResponse(
        document_id=document_id,
        config_id=config_id,
        embedding_model=config.embedding_model.value,
        dimension=embedder.dimension,
        chunks_embedded=len(vectors),
        collection=f"config_{config_id}",
    )
