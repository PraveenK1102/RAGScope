"""
RAGScope chunking engine.

A Chunker takes raw document text + a chunk_size/overlap config and returns
a list of ChunkOutput objects — each one annotated with enough metadata to
trace it back to the exact byte range of the source document.

Three strategies live here (filled in one at a time):
    - FixedSizeChunker    — blind N-char slicing, the baseline
    - RecursiveChunker    — LangChain's structure-aware splitter
    - SemanticChunker     — embedding-based topic-shift detection

The API layer never calls a concrete chunker directly. It calls `get_chunker()`
(factory at the bottom of this file) with a ChunkStrategy enum and gets back
the right BaseChunker implementation. This keeps the routes decoupled from the
strategy choice and makes swapping strategies a one-line config change.
"""

from abc import ABC, abstractmethod
from typing import ClassVar
from pydantic import BaseModel, Field
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_experimental.text_splitter import SemanticChunker as LCSemanticChunker
from langchain_huggingface import HuggingFaceEmbeddings
from backend.db.models import ChunkStrategy

# ---------------------------------------------------------------------------
# ChunkOutput — the in-memory representation of a freshly produced chunk.
#
# Distinct from the `Chunk` SQLAlchemy model in db/models.py:
#   - ChunkOutput has no DB ids (no document_id / config_id FK) — the chunker
#     shouldn't know or care about persistence.
#   - ChunkOutput carries `source_doc` (filename) + `strategy_used` — useful
#     for debugging / tracing but not stored as columns (they're inferable
#     from the FK to Document and the parent Config).
#
# The API layer bridges ChunkOutput → Chunk when saving to the DB.
# ---------------------------------------------------------------------------
class ChunkOutput(BaseModel):
    """One chunk produced by a chunker. Pure data — no DB ties."""

    content: str = Field(..., description="The chunk text itself.")
    chunk_index: int = Field(..., description="0-based position within the document.")
    start_char: int = Field(..., description="Inclusive start offset in the source text.")
    end_char: int = Field(..., description="Exclusive end offset in the source text.")
    source_doc: str = Field(..., description="Source document filename — for debugging.")
    strategy_used: str = Field(..., description="Which chunker produced this chunk.")
    char_count: int = Field(..., description="len(content) — cached for the UI.")


# ---------------------------------------------------------------------------
# BaseChunker — abstract interface every strategy implements.
#
# Subclasses must:
#   1. Set `strategy_name` (matches ChunkStrategy enum value in db/models.py)
#   2. Implement `chunk(text, source_doc) -> list[ChunkOutput]`
#
# chunk_size / chunk_overlap live on the base so every strategy has them,
# even if a given strategy (e.g. SemanticChunker) treats them as hints
# rather than hard bounds.
# ---------------------------------------------------------------------------
class BaseChunker(ABC):
    """Common interface for every chunking strategy."""

    # Subclasses override — matches the string value of ChunkStrategy enum.
    strategy_name: ClassVar[str]

    def __init__(self, chunk_size: int, chunk_overlap: int) -> None:
        if chunk_overlap >= chunk_size:
            raise ValueError(
                f"chunk_overlap ({chunk_overlap}) must be < chunk_size ({chunk_size}) "
                "overlapping by more than the chunk size causes infinite loops."
            )
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    @abstractmethod
    def chunk(self, text: str, source_doc: str) -> list[ChunkOutput]:
        """Split `text` into a list of ChunkOutput objects.

        Args:
            text:        Raw document text to split.
            source_doc:  Filename of the source document (for ChunkOutput metadata).

        Returns:
            Ordered list of chunks — chunk_index matches list position.
        """


# ---------------------------------------------------------------------------
# Concrete strategies go below here. You will fill these in next:
#
#   class FixedSizeChunker(BaseChunker): ...
#   class RecursiveChunker(BaseChunker): ...
#   class SemanticChunker(BaseChunker): ...
#
# And finally a `get_chunker(strategy, chunk_size, chunk_overlap) -> BaseChunker`
# factory so the API layer can pick one by ChunkStrategy enum value.
# ---------------------------------------------------------------------------

class FixedSizeChunker(BaseChunker):
    strategy_name = "fixed"

    def chunk(self, text: str, source_doc: str) -> list[ChunkOutput]:
        chunks = []
        step = self.chunk_size - self.chunk_overlap
        chunk_index = 0

        for start in range(0, len(text), step):
            end = min(start + self.chunk_size, len(text))
            chunks.append(ChunkOutput(
                content=text[start:end],
                chunk_index=chunk_index,
                start_char=start,
                end_char=end,
                source_doc=source_doc,
                strategy_used=self.strategy_name,
                char_count=end - start,
            ))
            chunk_index += 1
            if end >= len(text):
                break
        return chunks

class RecursiveChunker(BaseChunker):
    strategy_name = "recursive"

    def chunk(self, text: str, source_doc: str) -> list[ChunkOutput]:
        chunks = []
        splitter = RecursiveCharacterTextSplitter(chunk_size=self.chunk_size, chunk_overlap=self.chunk_overlap)
        chunk_splits = splitter.split_text(text)
        cursor = 0
        for chunk_index, chunk_split in enumerate(chunk_splits):
            start = text.find(chunk_split, cursor)
            if start == -1:
                start = cursor
            end = start + len(chunk_split)
            chunks.append(ChunkOutput(
                content=chunk_split,
                chunk_index=chunk_index,
                start_char=start,
                end_char=end,
                source_doc=source_doc,
                strategy_used=self.strategy_name,
                char_count=len(chunk_split),
            )) 
            cursor = start + 1
        return chunks

class SemanticChunker(BaseChunker):
    strategy_name = "semantic"

    def __init__(self, chunk_size: int, chunk_overlap: int) -> None:
        super().__init__(chunk_size, chunk_overlap)
        self.embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")

    def chunk(self, text: str, source_doc: str) -> list[ChunkOutput]:
        # LangChain's SemanticChunker normalises whitespace when it reassembles
        # groups of sentences into a chunk — so `split_text()` output is NOT a
        # substring of the source (spaces replace newlines, etc.), which makes
        # `text.find()` return -1 and silently misalign every chunk position.
        #
        # The reliable way to get exact offsets is `create_documents` with
        # `add_start_index=True` — the Document metadata then carries the
        # start position of the first sentence in each chunk. Consecutive
        # chunks are contiguous (no overlap for semantic strategy), so we use
        # the next chunk's start as the current chunk's end, and fall back to
        # len(text) for the final chunk.
        splitter = LCSemanticChunker(self.embeddings, add_start_index=True)
        docs = splitter.create_documents([text])

        chunks: list[ChunkOutput] = []
        for i, doc in enumerate(docs):
            start = doc.metadata["start_index"]
            end = docs[i + 1].metadata["start_index"] if i + 1 < len(docs) else len(text)
            # Use the original-text slice — not doc.page_content — so highlighting
            # overlays land on the actual bytes the user uploaded.
            content = text[start:end]
            chunks.append(ChunkOutput(
                content=content,
                chunk_index=i,
                start_char=start,
                end_char=end,
                source_doc=source_doc,
                strategy_used=self.strategy_name,
                char_count=len(content),
            ))
        return chunks

def get_chunker(strategy: ChunkStrategy, chunk_size: int, chunk_overlap: int) -> BaseChunker:
    if strategy == ChunkStrategy.FIXED:
        return FixedSizeChunker(chunk_size, chunk_overlap)
    elif strategy == ChunkStrategy.RECURSIVE:
        return RecursiveChunker(chunk_size, chunk_overlap)
    elif strategy == ChunkStrategy.SEMANTIC:
        return SemanticChunker(chunk_size, chunk_overlap)
    else:
        raise ValueError(f"Invalid chunk strategy: {strategy}")