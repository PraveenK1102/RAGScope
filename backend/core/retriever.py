"""
RAGScope retriever.

Given a question and a Config, returns the top-K chunks from that config's
ChromaDB collection that are nearest to the question in embedding space.

Week 4 supports only vector retrieval — one mode, one function. Week 6
will add BM25 + hybrid (and at that point this module will likely grow
a BaseRetriever class hierarchy, same pattern as embedder.py).

The retriever is a *composition* of Week 3's pieces:
    - Embedder    (text  -> vector)            via get_embedder(...)
    - Vector store (vector -> nearest chunks)  via get_collection(...)
plus the Config (which model, which collection, how many results).

It does no embedding or storage work itself — its only job is to wire
those two together and map Chroma's specific response shape into a
clean RetrievalResult list the rest of the codebase can use.
"""

from pydantic import BaseModel

from backend.core.embedder import get_embedder
from backend.core.vector_store import get_collection
from backend.db.models import Config


# ---------------------------------------------------------------------------
# RetrievalResult — one chunk returned by retrieval, with its similarity
# score. Stored on QueryTrace.retrieved_chunks as JSON, so keep it Pydantic
# primitive types only (no SQLAlchemy objects).
#
# `distance` is Chroma's cosine distance — lower = closer. Roughly
# `1 - cosine_similarity`, in the range [0, 2] but realistically [0, 1]
# for sentence-embedder vectors.
# ---------------------------------------------------------------------------
class RetrievalResult(BaseModel):
    """One chunk returned by retrieval, paired with its distance score."""

    chunk_id: int            # SQLite primary key (lets the trace UI link back)
    content: str             # the chunk text — already on the Chroma row
    distance: float          # cosine distance (lower = more similar)
    document_id: int
    chunk_index: int
    start_char: int
    end_char: int


# ---------------------------------------------------------------------------
# retrieve — top-level entry point. The query route calls this function.
# You write the body.
#
# Steps to implement:
#
#   1. Get the embedder that matches the config's embedding model:
#          embedder = get_embedder(config.embedding_model)
#
#   2. Embed the question. embed() takes a batch, so wrap in a list and
#      pull index [0] back out:
#          qvec = embedder.embed([question])[0]
#
#   3. Get the per-config Chroma collection:
#          collection = get_collection(config.id)
#
#   4. Query for the top-K nearest chunks:
#          result = collection.query(
#              query_embeddings=[qvec],
#              n_results=config.top_k,
#          )
#
#   5. Map Chroma's response into list[RetrievalResult].
#      Important: the outer list of every key has length 1 (one question
#      in, one batch out), so index [0] to flatten before zipping.
#
#         ids       = result["ids"][0]         # list[str]  — chunk ids as strings
#         documents = result["documents"][0]   # list[str]  — chunk text
#         distances = result["distances"][0]   # list[float]
#         metadatas = result["metadatas"][0]   # list[dict] — {document_id, chunk_index, start_char, end_char, ...}
#
#      Then zip the four together and build a RetrievalResult for each
#      tuple. Remember to int() the chunk id (Chroma stores ids as
#      strings, but our DB uses int primary keys).
#
#   6. Return the list.
#
# Edge case: if the collection has fewer than top_k vectors, Chroma
# returns however many it has — no error. Your code should handle the
# "fewer than K" case naturally (just return what came back).
# ---------------------------------------------------------------------------
def retrieve(question: str, config: Config) -> list[RetrievalResult]:
    """Return the top-K chunks most relevant to `question` under `config`."""
    embedder = get_embedder(config.embedding_model)
    collection = get_collection(config.id)
    qvec = embedder.embed([question])[0]
    result = collection.query(
        query_embeddings=[qvec],
        n_results=config.top_k
    )
    ids = result["ids"][0]
    documents = result["documents"][0]
    distances = result["distances"][0]
    metadatas = result["metadatas"][0]
    return [
        RetrievalResult(
            chunk_id=int(chunk_id_str),
            content=document,
            distance=distance,
            document_id=metadata["document_id"],
            chunk_index=metadata["chunk_index"],
            start_char=metadata["start_char"],
            end_char=metadata["end_char"],
        )
        for chunk_id_str, document, distance, metadata in zip(
            ids, documents, distances, metadatas
        )
    ]