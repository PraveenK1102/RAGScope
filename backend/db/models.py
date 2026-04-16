"""
SQLAlchemy ORM models for RAGScope.

Every model inherits from `Base` (defined in database.py). When FastAPI starts
we call `Base.metadata.create_all(engine)` which issues `CREATE TABLE IF NOT
EXISTS` for each class below.

Models are added incrementally:
  - Document        (Week 1)
  - Config          (Week 1)
  - Chunk           (Week 2)
  - QueryTrace      (Week 4)
  - Evaluation      (Week 7)
"""

from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from backend.db.database import Base


# ---------------------------------------------------------------------------
# Enums for constrained fields on the Config model. Using StrEnum (Python
# 3.11+) means each member IS a string at runtime, which keeps JSON
# serialisation trivial and lets SQLite store the value as plain text.
# ---------------------------------------------------------------------------
class ChunkStrategy(StrEnum):
    FIXED = "fixed"          # FixedSizeChunker — splits every N chars
    RECURSIVE = "recursive"  # LangChain RecursiveCharacterTextSplitter
    SEMANTIC = "semantic"    # LangChain SemanticChunker (embedding-based)


class EmbeddingModel(StrEnum):
    OLLAMA_NOMIC = "ollama-nomic-embed-text"   # 768 dims, via Ollama
    MINILM = "all-MiniLM-L6-v2"                # 384 dims, via sentence-transformers


class RetrievalMode(StrEnum):
    VECTOR = "vector"   # pure vector similarity (default)
    BM25 = "bm25"       # lexical search only
    HYBRID = "hybrid"   # weighted merge of vector + BM25


# A sensible default prompt template for Week 4+ generation. {context} and
# {question} are the fields the Generator will fill in.
DEFAULT_PROMPT_TEMPLATE = (
    "Answer the question using only the context below. "
    "If the answer isn't in the context, say you don't know — "
    "do not make up information.\n\n"
    "Context:\n{context}\n\n"
    "Question: {question}\n\n"
    "Answer:"
)


class Document(Base):
    """A raw uploaded document — PDF, TXT, or MD — with its extracted text."""

    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=func.now(),
    )

    def __repr__(self) -> str:
        return f"<Document id={self.id} filename={self.filename!r}>"


class Config(Base):
    """A RAG pipeline configuration — the unit users create, compare, and evaluate."""

    __tablename__ = "configs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)

    # --- Chunking (Week 2) -------------------------------------------------
    chunk_strategy: Mapped[ChunkStrategy] = mapped_column(
        SAEnum(ChunkStrategy, name="chunk_strategy_enum"),
        nullable=False,
    )
    chunk_size: Mapped[int] = mapped_column(Integer, nullable=False)
    chunk_overlap: Mapped[int] = mapped_column(Integer, nullable=False)

    # --- Embedding (Week 3) ------------------------------------------------
    embedding_model: Mapped[EmbeddingModel] = mapped_column(
        SAEnum(EmbeddingModel, name="embedding_model_enum"),
        nullable=False,
    )

    # --- Retrieval (Weeks 4 and 6) ----------------------------------------
    top_k: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    retrieval_mode: Mapped[RetrievalMode] = mapped_column(
        SAEnum(RetrievalMode, name="retrieval_mode_enum"),
        nullable=False,
        default=RetrievalMode.VECTOR,
        server_default=RetrievalMode.VECTOR.value,
    )
    reranking_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",  # SQLite stores booleans as 0/1
    )

    # --- Generation (Week 4) ----------------------------------------------
    prompt_template: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        default=DEFAULT_PROMPT_TEMPLATE,
        server_default=DEFAULT_PROMPT_TEMPLATE,
    )

    def __repr__(self) -> str:
        return (
            f"<Config id={self.id} name={self.name!r} "
            f"strategy={self.chunk_strategy.value} model={self.embedding_model.value}>"
        )
