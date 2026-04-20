"""
Chunks API — lazy chunk materialisation and retrieval.

GET /api/chunks/{document_id}/{config_id}
    Returns every chunk produced by running `config` against `document`.

    Lazy behaviour (Week 2 design decision):
        - First call for a given (doc, cfg) pair:   run the chunker,
          persist rows to `chunks`, return them.
        - Subsequent calls:                          read the cached rows.

    This means uploading a document is instant — no chunking work fires
    until someone actually asks to see chunks for a specific config. And
    switching strategies never rechunks existing pairs (they're keyed by
    both document_id and config_id).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from backend.core.chunker import get_chunker
from backend.db.database import get_db
from backend.db.models import Chunk, Config, Document


router = APIRouter(prefix="/api/chunks", tags=["chunks"])


# ---------------------------------------------------------------------------
# Response schemas. Same pattern as documents.py — Pydantic for the wire,
# SQLAlchemy for the DB, bridged by model_config.from_attributes.
# ---------------------------------------------------------------------------
class ChunkRead(BaseModel):
    """One chunk as returned to the client."""

    chunk_index: int
    content: str
    start_char: int
    end_char: int
    char_count: int  # computed — not a DB column

    model_config = ConfigDict(from_attributes=True)


class ChunksResponse(BaseModel):
    """Wraps the chunk list with aggregate stats for the viewer UI."""

    document_id: int
    config_id: int
    strategy_used: str
    total_chunks: int
    avg_char_count: float
    chunks: list[ChunkRead]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _materialise_chunks(db: Session, document: Document, config: Config) -> list[Chunk]:
    """Run the configured chunker and persist the resulting rows.

    Caller must have already verified no chunks exist for this (doc, cfg).
    Commits the transaction.
    """
    chunker = get_chunker(
        strategy=config.chunk_strategy,
        chunk_size=config.chunk_size,
        chunk_overlap=config.chunk_overlap,
    )
    chunk_outputs = chunker.chunk(document.content, document.filename)

    rows = [
        Chunk(
            document_id=document.id,
            config_id=config.id,
            content=co.content,
            chunk_index=co.chunk_index,
            start_char=co.start_char,
            end_char=co.end_char,
            # embedding stays NULL until Week 3
        )
        for co in chunk_outputs
    ]
    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get(
    "/{document_id}/{config_id}",
    response_model=ChunksResponse,
    summary="List chunks for a document under a given config (lazy-materialises on first call)",
)
def get_chunks(
    document_id: int,
    config_id: int,
    db: Session = Depends(get_db),
) -> ChunksResponse:
    # 1. Validate both IDs exist — 404 early if not
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Document {document_id} not found")

    config = db.get(Config, config_id)
    if config is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Config {config_id} not found")

    # 2. Read cached chunks, or chunk-on-first-hit
    cached = (
        db.query(Chunk)
        .filter(Chunk.document_id == document_id, Chunk.config_id == config_id)
        .order_by(Chunk.chunk_index)
        .all()
    )
    if not cached:
        cached = _materialise_chunks(db, document, config)
        cached.sort(key=lambda c: c.chunk_index)

    # 3. Build response with aggregate stats
    total = len(cached)
    avg = (sum(len(c.content) for c in cached) / total) if total else 0.0
    return ChunksResponse(
        document_id=document_id,
        config_id=config_id,
        strategy_used=config.chunk_strategy.value,
        total_chunks=total,
        avg_char_count=round(avg, 2),
        chunks=[
            ChunkRead(
                chunk_index=c.chunk_index,
                content=c.content,
                start_char=c.start_char,
                end_char=c.end_char,
                char_count=len(c.content),
            )
            for c in cached
        ],
    )
