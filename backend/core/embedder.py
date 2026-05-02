"""
RAGScope embedding engine.

An Embedder takes a batch of text and returns one fixed-length vector per
input, in order. Vectors from different models live in incompatible spaces —
a MiniLM vector (384 dims) cannot be compared with an Ollama nomic vector
(768 dims), and even same-dimension models from different families aren't
interchangeable. That's why each pipeline Config pins a single embedding
model, and why each ChromaDB collection (one per Config) only ever sees
one dimension.

Two backends live here (you will fill these in one at a time):
    - MiniLMEmbedder  — sentence-transformers, 384-dim, fully local
    - OllamaEmbedder  — HTTP call to the local Ollama server, 768-dim

The API layer never calls a concrete embedder directly. It calls
`get_embedder(EmbeddingModel)` which returns a cached instance — loading
MiniLM takes ~2s the first time (weight download + model init), so we
reuse the same instance for every request. One cached instance *per
model*; models don't share state, so a MiniLM call never reuses an Ollama
instance or vice versa.
"""

from abc import ABC, abstractmethod
from typing import ClassVar

from backend.db.models import EmbeddingModel
from sentence_transformers import SentenceTransformer

import ollama

# ---------------------------------------------------------------------------
# EmbedderUnavailable — raised when the underlying backend can't be reached
# at call time.
#
# Only Ollama realistically hits this today — the MiniLM model runs in our
# own Python process, so if it fails to load we have bigger problems. The
# route layer catches this and returns a 503 with a helpful message instead
# of a generic 500.
# ---------------------------------------------------------------------------
class EmbedderUnavailable(RuntimeError):
    """Raised when an embedder backend is installed but not reachable."""


# ---------------------------------------------------------------------------
# BaseEmbedder — abstract interface every embedding backend implements.
#
# Subclasses must:
#   1. Set `model_id` — matches EmbeddingModel enum value in db/models.py.
#      This is how `get_embedder` maps an enum to a class.
#   2. Set `dimension` — the fixed vector length the model emits. Used by
#      the vector-store wrapper to sanity-check Chroma collection dims and
#      to document the contract for readers.
#   3. Implement `embed(texts) -> list[list[float]]` — batch in, batch out.
#      Order of the output MUST match order of the input.
# ---------------------------------------------------------------------------
class BaseEmbedder(ABC):
    """Common interface for every embedding backend."""

    # Subclasses override — matches the string value of EmbeddingModel enum.
    model_id: ClassVar[str]
    # Fixed vector length this model emits.
    dimension: ClassVar[int]

    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]:
        """Return one vector per input text, in order.

        Args:
            texts: Batch of strings to embed. Empty list is allowed and
                should return an empty list without calling the backend.

        Returns:
            list[list[float]] of length `len(texts)`. Each inner list is
            exactly `self.dimension` floats long.

        Raises:
            EmbedderUnavailable: If the backend is unreachable at call
                time (e.g. Ollama server not running). Backends that
                cannot fail this way need not raise it.
        """


class MiniLMEmbedder(BaseEmbedder):
    model_id = EmbeddingModel.MINILM.value
    dimension = 384

    def __init__(self) -> None:
        self.model = SentenceTransformer("all-MiniLM-L6-v2")

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        encoded_text = self.model.encode(texts)
        return encoded_text.tolist()

class OllamaEmbedder(BaseEmbedder):
    model_id = EmbeddingModel.OLLAMA_NOMIC.value
    dimension = 768
    OLLAMA_MODEL: ClassVar[str] = "nomic-embed-text"

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        try:
            response = ollama.embed(model=self.OLLAMA_MODEL, input=texts)
            return response.embeddings
        except ConnectionError as e:
            raise EmbedderUnavailable(f"Failed to connect to Ollama: {e}")
        except ollama.ResponseError as e:
            raise EmbedderUnavailable(f"Failed to embed text: {e}")
# ---------------------------------------------------------------------------
# Concrete embedders go below here. You will fill these in next:
#
#   class MiniLMEmbedder(BaseEmbedder): ...
#     model_id  = EmbeddingModel.MINILM.value          # "all-MiniLM-L6-v2"
#     dimension = 384
#
#     __init__: instantiate `SentenceTransformer("all-MiniLM-L6-v2")` once,
#               stash on self. First call triggers a ~90MB weight download
#               into the local HF cache; later calls are instant.
#     embed:    self.model.encode(texts) returns a NumPy ndarray of shape
#               (len(texts), 384). Convert to list[list[float]] before
#               returning — Chroma wants plain Python floats, not numpy.
#
#   class OllamaEmbedder(BaseEmbedder): ...
#     model_id  = EmbeddingModel.OLLAMA_NOMIC.value    # "ollama-nomic-embed-text"
#                                                      #   — our internal
#                                                      #   disambiguated name
#     dimension = 768
#
#     Heads-up: our enum value is "ollama-nomic-embed-text" (tells the
#     reader which backend), but Ollama itself knows the model as
#     "nomic-embed-text". So the `ollama.embed(model=..., input=texts)`
#     call takes the *Ollama* name, NOT our enum value. Store it as a
#     class constant like `OLLAMA_MODEL = "nomic-embed-text"` for clarity.
#
#     __init__: nothing to load — Ollama is a separate process. You can
#               leave it as the default, or store a client handle if you
#               want (the ollama module's top-level functions already
#               target localhost:11434).
#     embed:    response = ollama.embed(model=OLLAMA_MODEL, input=texts)
#               return response.embeddings  # already list[list[float]]
#               Wrap the call in try/except to catch ConnectionError and
#               ollama.ResponseError — re-raise as EmbedderUnavailable
#               with a helpful message.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Instance cache + factory.
#
# Loading MiniLM triggers a ~90MB weight download (first run only) and
# ~2s of tensor init. We keep one instance per model per process — enough
# to share across every request in an uvicorn worker without leaking
# memory (there are only ever two possible keys).
#
# The cache is keyed by the EmbeddingModel enum, not the class, so it
# maps naturally onto the `config.embedding_model` column.
# ---------------------------------------------------------------------------
_INSTANCES: dict[EmbeddingModel, BaseEmbedder] = {}


def get_embedder(model: EmbeddingModel) -> BaseEmbedder:
    """Return a cached embedder instance for the given model.

    First call for each model triggers construction (loads weights for
    MiniLM, effectively a no-op for Ollama); subsequent calls return the
    same instance.
    """
    if model not in _INSTANCES:
        if model == EmbeddingModel.MINILM:
            _INSTANCES[model] = MiniLMEmbedder()
        elif model == EmbeddingModel.OLLAMA_NOMIC:
            _INSTANCES[model] = OllamaEmbedder()
        else:
            raise ValueError(f"Unsupported embedding model: {model}")
    return _INSTANCES[model]
