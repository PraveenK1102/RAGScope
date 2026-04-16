"""
Configs API — create, fetch, and list RAG pipeline configurations.

POST /api/configs          create a new pipeline config
GET  /api/configs/{id}     fetch a single config by id (404 if not found)
GET  /api/configs          list every config (most recent first)

Week 1 only accepts the six "core" fields in the request body
(name + chunking + embedding + top_k). Retrieval mode, reranking, and
prompt template fall back to the server-side defaults on the DB column.
Later weeks (4, 6) will extend the request schema.
"""

from typing import Self

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy.orm import Session

from backend.db.database import get_db
from backend.db.models import (
    ChunkStrategy,
    Config,
    EmbeddingModel,
    RetrievalMode,
)

router = APIRouter(prefix="/api/configs", tags=["configs"])


# ---------------------------------------------------------------------------
# Request schema — what clients send when creating a config.
# Pydantic's Field(...) attaches constraints. Anything that fails a constraint
# turns into a 422 Unprocessable Entity with a structured error list,
# automatically, before the handler runs.
# ---------------------------------------------------------------------------
class ConfigCreate(BaseModel):
    name: str = Field(min_length=1, max_length=256, description="Human-readable label")
    chunk_strategy: ChunkStrategy
    chunk_size: int = Field(gt=0, le=4096, description="Target characters per chunk")
    chunk_overlap: int = Field(ge=0, le=1024, description="Characters shared between neighbouring chunks")
    embedding_model: EmbeddingModel
    top_k: int = Field(gt=0, le=100, default=5, description="How many chunks to retrieve per query")

    @model_validator(mode="after")
    def overlap_smaller_than_size(self) -> Self:
        """Overlap larger than chunk_size would produce infinite overlap loops."""
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError(
                f"chunk_overlap ({self.chunk_overlap}) must be less than chunk_size ({self.chunk_size})"
            )
        return self


# ---------------------------------------------------------------------------
# Response schema — what we send back. Includes every column from the Config
# row so the client can display the full resolved configuration (including
# the server-defaulted fields).
# ---------------------------------------------------------------------------
class ConfigRead(BaseModel):
    id: int
    name: str
    chunk_strategy: ChunkStrategy
    chunk_size: int
    chunk_overlap: int
    embedding_model: EmbeddingModel
    top_k: int
    retrieval_mode: RetrievalMode
    reranking_enabled: bool
    prompt_template: str

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.post(
    "",
    response_model=ConfigRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new RAG pipeline configuration",
)
async def create_config(payload: ConfigCreate, db: Session = Depends(get_db)) -> Config:
    """Persist a new Config. Server-side defaults fill retrieval_mode,
    reranking_enabled, and prompt_template."""

    cfg = Config(**payload.model_dump())
    db.add(cfg)
    db.commit()
    db.refresh(cfg)  # pulls the default retrieval_mode, reranking_enabled, prompt_template
    return cfg


@router.get(
    "/{config_id}",
    response_model=ConfigRead,
    summary="Fetch a single config by id",
)
async def get_config(config_id: int, db: Session = Depends(get_db)) -> Config:
    cfg = db.get(Config, config_id)
    if cfg is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail=f"config {config_id} not found",
        )
    return cfg


@router.get(
    "",
    response_model=list[ConfigRead],
    summary="List all configs (most recent first)",
)
async def list_configs(db: Session = Depends(get_db)) -> list[Config]:
    return db.query(Config).order_by(Config.id.desc()).all()
