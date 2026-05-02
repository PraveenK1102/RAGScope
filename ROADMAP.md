# RAGScope Roadmap

Week-by-week execution log for the 10-week build. Updated as each week completes.

**Working split** — Claude scaffolds boilerplate I already know (routes, DB
schemas, React shells, wiring); I write the core GenAI logic by hand (chunker,
embedder, retriever, generator, agent, MCP server).

**Status legend:** ✅ complete · 🚧 in progress · 🔜 up next · ⬜ not started

---

## Week 1 — Scaffolding ✅

**Goal:** Running FastAPI + SQLite backend, Vite + React + Tailwind frontend,
end-to-end flow for uploading documents and creating pipeline configs.

### Backend deliverables

- **`backend/main.py`** — FastAPI app with `lifespan` hook
  (`Base.metadata.create_all` on startup), CORS middleware for the Vite dev
  server, `/health` route, and two feature routers mounted.
- **`backend/db/database.py`** — SQLAlchemy 2.x engine/SessionLocal/Base.
  DB URL from `RAGSCOPE_DB_URL` env var, falls back to `sqlite:///./ragscope.db`.
  `get_db()` generator for FastAPI's dependency injection.
- **`backend/db/models.py`** — ORM models using SQLAlchemy 2.x
  `Mapped[T] = mapped_column(...)` style.
  - `Document` — `id`, `filename`, `content`, `uploaded_at`
  - `Config` — 10 columns; 6 user-facing in Week 1, 4 server-defaulted
    (`retrieval_mode`, `reranking_enabled`, `prompt_template`) for later weeks
  - Enums as Python 3.11 `StrEnum`: `ChunkStrategy`, `EmbeddingModel`,
    `RetrievalMode`
- **`backend/api/routes/documents.py`** — `POST /api/documents/upload`
  (multipart, `.pdf`/`.txt`/`.md`, text extraction via `pypdf`), `GET /api/documents`
  (list, excludes the large `content` column via separate Pydantic schema).
- **`backend/api/routes/configs.py`** — `POST /api/configs`, `GET /api/configs`,
  `GET /api/configs/{id}`. Pydantic `Field(...)` constraints on every input;
  cross-field `@model_validator` rejects `chunk_overlap >= chunk_size` with 422.

### Frontend deliverables

- **`frontend/`** — Vite 5 + React 18 + TypeScript + Tailwind CSS v3.
  (Tailwind v4 needs Node 20+; repo is on Node 18, so pinned to v3.)
- **`frontend/src/api/client.ts`** — typed fetch wrappers for every backend
  route. One `apiFetch<T>()` helper centralises error handling; separate
  `uploadDocument()` for the multipart flow. TypeScript types mirror the
  Pydantic response schemas.
- **`frontend/src/App.tsx`** — tabbed shell (Documents · Configs) with
  `useState<Tab>` for switching. Header + nav + `<main>` with conditional
  rendering.
- **`frontend/src/components/DocumentsTab.tsx`** — list view with
  three-state pattern (`loading` / `error` / `data`), empty-state nudge,
  pulsing skeleton while fetching. Wires `UploadZone` and prepends the
  returned `Document` on success (no refetch).
- **`frontend/src/components/UploadZone.tsx`** — drag-and-drop + click-to-upload.
  Hidden `<input type="file">` triggered by a ref on zone click. Client-side
  extension check mirrors the backend's allow-list.
- **`frontend/src/components/ConfigsTab.tsx`** — list view, "+ New config"
  toggle, sub-components for rows with compact badges showing strategy /
  embedding / size / overlap / top-k.
- **`frontend/src/components/ConfigForm.tsx`** — single `useState<ConfigCreate>`
  object for all 6 fields, typed generic `setField<K>()` helper. Two layers
  of validation: inline `overlapTooLarge` + server-side 422 surface.

### Key decisions

- **Flat folder structure** — `backend/`, `frontend/`, `mcp_server/`, `tests/`
  directly under repo root. No extra `ragscope/` nesting.
- **Repo-level `.venv/`** (not inside `backend/`).
- **SQLAlchemy 2.x syntax** — `DeclarativeBase` subclass and
  `Mapped[T] = mapped_column(...)`, not the legacy `declarative_base()` /
  `Column(...)` style.
- **`Base.metadata.create_all()` in lifespan** — issues
  `CREATE TABLE IF NOT EXISTS`, safe to run every boot. Does NOT alter
  existing tables; schema changes to existing tables need `rm ragscope.db`.
  Adding new tables is always safe.
- **Adding later-week models incrementally** — option (b): add `Chunk` in
  Week 2, `QueryTrace` in Week 4, `Evaluation` in Week 7 (not all upfront).
- **Server-side defaults on `Config`** — `retrieval_mode`, `reranking_enabled`,
  `prompt_template` have both Python `default=` and SQL `server_default=`.
  Lets Week 1 accept a 6-field POST body while the DB column is still
  populated correctly for later weeks.
- **Pydantic v2 `ConfigDict(from_attributes=True)`** on response models —
  FastAPI can hand a SQLAlchemy instance straight through.
- **Separate Pydantic response vs ORM model** — `DocumentRead` omits the
  large `content` field so list responses stay small.
- **Frontend three-piece state (`data`/`loading`/`error`)** — canonical
  shape for any async-fetched UI; covers loading / empty / error / data
  paths without ambiguous combinations.
- **Typed API client in one module** — base URL from `import.meta.env.VITE_API_URL`
  with localhost fallback; every call returns a typed Promise.
- **Vite upgraded from 3 → 5** during frontend setup to match Tailwind
  plugin peer-dep requirements, then Tailwind pinned to v3 anyway for
  Node 18 compatibility.

### How to run

```bash
# Backend (from repo root, in .venv)
.venv/bin/uvicorn backend.main:app --reload
# → http://localhost:8000/docs for Swagger UI

# Frontend
cd frontend
npm run dev
# → http://localhost:5173
```

### What I learned

- SQLAlchemy 2.x `Mapped[T]` + `mapped_column` annotation style
- `DeclarativeBase` subclass pattern vs old `declarative_base()` function
- `server_default` vs Python `default` (and why `db.refresh()` is needed
  to surface server defaults back to the Python object)
- `StrEnum` (Python 3.11+) → transparent JSON + SQLite storage
- FastAPI `lifespan` async context manager (replaces deprecated
  `@app.on_event("startup")`)
- APIRouter with per-feature prefix/tags for Swagger organisation
- `Depends(get_db)` generator pattern with `try/finally` close
- Pydantic v2 `Field(gt=..., le=..., min_length=...)` per-field constraints
- Pydantic v2 `@model_validator(mode="after")` for cross-field rules
- `ConfigDict(from_attributes=True)` (was `orm_mode=True` in v1)
- Vite + React + TS scaffolding and the Tailwind v3 three-directive setup
- HTML5 drag-and-drop gotcha: `onDragOver` MUST call `preventDefault()` or
  `onDrop` never fires
- Hidden `<input type="file">` + `useRef` click-to-open file picker pattern
- Functional state update `setX((prev) => ...)` to avoid stale-closure bugs
- Typed generic helpers: `setField<K extends keyof T>(key: K, value: T[K])`
- CORS middleware placement (before routers so it wraps every request)

---

## Week 2 — Chunker ✅

**Goal:** Three chunking strategies + `Chunk` model + a route that chunks a
document under a chosen config, plus a UI that shows chunks side-by-side for
up to three configs on the same document.

### Backend deliverables

- **`backend/db/models.py`** — added `Chunk` model. `(document_id, config_id)`
  as composite identity so the same document chunked under two configs
  produces two disjoint row sets — switching strategies never mutates
  existing chunks. `embedding: Mapped[bytes | None]` column present but NULL
  until Week 3.
- **`backend/core/chunker.py`** (hand-written) — three strategies behind a
  shared `BaseChunker` interface.
  - `FixedSizeChunker` — blind sliding window over the raw text.
    `step = chunk_size - chunk_overlap`. O(n).
  - `RecursiveChunker` — LangChain `RecursiveCharacterTextSplitter`.
    Offsets recovered with `text.find(chunk, cursor)` because the splitter
    doesn't expose them; cursor advances so repeated substrings don't
    collapse into the same position.
  - `SemanticChunker` — LangChain `SemanticChunker` (embedding-based).
    Uses `create_documents(..., add_start_index=True)` instead of
    `split_text` — the latter normalises whitespace, which breaks
    `text.find` and silently misaligns every offset. MiniLM loaded locally
    via `HuggingFaceEmbeddings`.
  - `get_chunker(strategy, chunk_size, chunk_overlap)` factory dispatches
    on the `ChunkStrategy` enum so routes stay decoupled from concrete
    strategies.
  - Base-class `__init__` rejects `chunk_overlap >= chunk_size` — prevents
    the FixedSizeChunker infinite loop.
- **`backend/api/routes/chunks.py`** — single lazy endpoint
  `GET /api/chunks/{document_id}/{config_id}`. First call for a pair runs
  the chunker and persists rows; subsequent calls are DB cache hits.
  Response wraps the chunk list with aggregate stats (`total_chunks`,
  `avg_char_count`) for the column headers.
- **`backend/api/routes/documents.py`** — added
  `GET /api/documents/{document_id}` returning the full extracted text
  (new `DocumentDetail` schema extending `DocumentRead` with `content`),
  powering the source-document panel in the chunk viewer.

### Frontend deliverables

- **`frontend/src/api/client.ts`** — added `Chunk` / `ChunksResponse` /
  `DocumentDetail` types and `fetchChunks(docId, cfgId)` + `getDocument(id)`
  helpers. Types mirror the new Pydantic schemas.
- **`frontend/src/components/ChunksTab.tsx`** — unified 1-vs-N viewer.
  - Document dropdown + config checklist (cap 3).
  - `Promise.allSettled` fires chunk fetches in parallel so one failing
    config doesn't hide the others.
  - Responsive 1 / 2 / 3-column grid — explicit class constants so
    Tailwind's JIT actually generates them.
  - Source-document panel below the grid renders the original text with
    per-chunk pastel fills (6-colour cycle so adjacent chunks always
    differ). Overlap regions get a dashed red border and no fill.
  - Segment construction: collect every unique boundary across all chunks,
    sort, emit one `Segment` per run of characters with the same owner set.
    Owners of length 1 → solid fill; ≥ 2 → overlap.
  - Semantic-strategy configs show size/overlap struck-through with a
    tooltip — the splitter ignores those params and the UI signals it.
- **`frontend/src/App.tsx`** — "Chunks" tab added; widens `<main>` to
  `max-w-[1600px]` when the comparison view is active so three columns fit.

### Key decisions

- **Lazy materialisation, not a preview route.** Uploading a document does
  no chunking work until someone actually asks for chunks under a specific
  config. Rows keyed on `(doc, cfg)` → re-chunking a pair is a no-op and
  switching strategies never mutates existing rows.
- **Unified 1-vs-N tab, not separate "Chunks" + "Compare" tabs.** Same
  pickers, same renderer, same data — one job with a variable column count.
  Splitting would duplicate UI and add navigation for no mental-model gain.
- **Size/overlap on the base class even though semantic ignores them.**
  Keeps the interface uniform so the factory stays dumb. The UI signals
  the semantic exception visually rather than the backend enforcing it.
- **Offsets via `text.find(chunk, cursor)` for RecursiveChunker.** LangChain
  doesn't return offsets. `cursor = start + 1` advances past the last match
  so duplicate substrings don't collapse to the same position.
- **`create_documents(add_start_index=True)` for SemanticChunker.** The
  obvious `split_text` path looks right but silently normalises whitespace,
  so `text.find` returns -1 on every chunk and offsets go wrong. Burned
  half a debugging session on this before switching.
- **Contiguous chunks for the semantic strategy.** No overlap between
  chunks — we derive each chunk's `end` from the next chunk's `start`
  (last chunk falls back to `len(text)`).
- **Embedding column on `chunks`, not a separate table.** Week 3 fills it
  in place; keeps the chunk ↔ embedding relationship 1:1 without a join.
- **Unit tests deferred.** Not a hard gate for Week 2 — the comparison
  viewer gives enough visual coverage to move on. Revisit if a future week
  touches the chunker.

### What I learned

- LangChain text-splitter APIs and their gotchas — `split_text` vs
  `create_documents`, and why the latter is the only reliable way to get
  exact offsets back.
- Python ABC pattern: `abc.ABC` + `@abstractmethod`, `ClassVar` for
  subclass-set metadata, and invariant checks in the base `__init__`.
- HuggingFace `sentence-transformers` MiniLM loaded via
  `langchain_huggingface.HuggingFaceEmbeddings` — 384-dim embeddings,
  fully local, no API key, first call warms the model.
- Offset-recovery trick (`text.find(needle, cursor)`) for libraries that
  split text without returning positions — cursor advance matters when
  the same substring appears multiple times.
- Tailwind JIT rule: class names must appear as literal strings in source
  (not interpolated), hence the explicit `grid-cols-1 / md:grid-cols-2 /
  md:grid-cols-3` constants instead of `grid-cols-${n}`.
- `Promise.allSettled` vs `Promise.all` — use `allSettled` when one
  branch failing shouldn't hide the rest.
- Overlap-aware rendering via boundary sweep: collect all unique
  starts/ends, sort, emit one segment per uniform-owner run. Generalises
  to N overlapping ranges without per-pair special-casing.
- Lazy DB materialisation pattern — idempotent on repeat calls, and a
  composite `(doc, cfg)` key removes any notion of "invalidating" a
  previous run.

---

## Week 3 — Embedder + vector store ✅

**Goal:** Embed every chunk of a (document, config) pair under the config's
embedding model, persist the vectors to ChromaDB, cache the raw bytes back
onto `chunks.embedding`, and expose a "Build embeddings" action per column
in the Chunks tab. Two model backends: MiniLM (local sentence-transformers,
384-dim) and nomic-embed-text via Ollama (768-dim).

### Backend deliverables

- **`backend/core/embedder.py`** (hand-written) — embedding engine.
  - `BaseEmbedder` abstract base with `model_id: ClassVar[str]`,
    `dimension: ClassVar[int]`, abstract `embed(texts) -> list[list[float]]`.
    Contract: order-preserving, batch in / batch out, empty-input
    short-circuits without calling the backend.
  - `MiniLMEmbedder` — wraps `SentenceTransformer("all-MiniLM-L6-v2")`.
    Loads once in `__init__`; `embed` calls `.encode(texts).tolist()` so
    the NumPy ndarray never crosses the module boundary.
  - `OllamaEmbedder` — uses the `ollama` Python SDK. Translates our
    internal enum value (`"ollama-nomic-embed-text"`) to the actual
    Ollama model name (`"nomic-embed-text"`) via a class constant.
    Catches `ConnectionError` and `ollama.ResponseError`, re-raises
    them as `EmbedderUnavailable` so the route can map to 503 with a
    helpful message ("is Ollama running?", "did you `ollama pull`?").
  - `_INSTANCES: dict[EmbeddingModel, BaseEmbedder]` module-level cache.
    `get_embedder()` constructs lazily on first hit; subsequent calls
    return the same instance. One cached instance per model per process.
- **`backend/core/vector_store.py`** — ChromaDB wrapper. Single point
  of contact between the rest of the codebase and Chroma.
  - Lazy module-level persistent client at `./chroma_db/` (gitignored).
  - `get_collection(config_id)` — get-or-create with
    `metadata={"hnsw:space": "cosine"}`.
  - `upsert_chunks(config_id, chunks, embeddings)` — id keyed on
    `str(chunk.id)`, document = chunk content, metadata =
    `{document_id, config_id, chunk_index, start_char, end_char}`.
    Idempotent — re-runs overwrite rather than duplicate.
  - `Chunk` import lives under `if TYPE_CHECKING:` to keep the door
    closed against future circular imports.
- **`backend/api/routes/embeddings.py`** — single endpoint
  `POST /api/embeddings/{document_id}/{config_id}/build`.
  - 404 if doc/config don't exist (validated up front).
  - 409 if no chunks exist for the pair (Chunks tab must materialise
    them first; we don't auto-chain so the failure mode stays
    attributable).
  - 503 if `EmbedderUnavailable` propagates (Ollama down, model not
    pulled).
  - 400 on factory `ValueError` (defensive — only fires if a future
    enum member is added without updating the dispatch).
  - Orchestration glue (hand-written): `get_embedder(cfg.embedding_model)
    → embed(batch) → write bytes to chunks.embedding → db.commit() →
    upsert_chunks()`. Commit-before-upsert chosen on review: if Chroma
    fails after the commit, SQLite is still consistent and the next
    attempt retries cleanly.
  - `_vector_to_bytes` / `_bytes_to_vector` helpers — float32 packing
    via stdlib `struct`. 4 bytes/float; dim inferred as
    `len(bytes) // 4`. Decoder isn't used in Week 3; kept for Week 4's
    rebuild-Chroma-from-cache path.
- **`backend/api/routes/chunks.py`** — `ChunksResponse.embedded_count: int`
  added so the chunk viewer can show "✓ embedded" status without an
  extra request.
- **`backend/main.py`** — `embeddings_routes.router` mounted alongside
  documents/configs/chunks.

### Frontend deliverables

- **`frontend/src/api/client.ts`** — added `embedded_count: number` on
  `ChunksResponse`, the `BuildEmbeddingsResponse` type, and
  `buildEmbeddings(documentId, configId)` POST helper with the standard
  error-mapping path.
- **`frontend/src/components/ChunksTab.tsx`** — per-column embed action.
  - `EmbedState` discriminated union: `idle | loading | success | error`.
    Exhaustive switch in `EmbedActionRow` rules out impossible-state
    bugs at compile time (e.g. "loading but also has error").
  - `ColumnResult` extended with `embed: EmbedState`. Initial state on
    chunks-load: `success` if `embedded_count === total_chunks > 0`
    (already-built pairs render correctly across reloads), else `idle`.
  - `handleBuild(configId, documentId)` mutates only the matching
    column's embed slice — two columns can build in parallel without
    interfering.
  - `EmbedActionRow` renders the four states: blue "Build embeddings"
    button, pulsing-dot loading indicator, green ✓ pill + "rebuild"
    link, or red error message + retry button.

### Key decisions

- **One Chroma collection per `Config.id`.** Each config pins one
  embedding model → one fixed dimension → one collection. Naturally
  satisfies Chroma's "one dimension per collection" rule with no
  bookkeeping. Names are stable (`f"config_{id}"`) so re-runs always
  hit the same collection.
- **Persistent Chroma client at `./chroma_db/`.** Gitignored. Survives
  uvicorn restarts; Week 4 retrieval can rely on it being there.
- **Lazy POST endpoint, no auto-chain.** If a pair has no chunks,
  return 409 instead of silently calling the chunker. Keeps error
  attribution clear: if embedding fails it's an embedder problem,
  not a chunker problem hidden inside an embedding call.
- **Cache embedding bytes in `chunks.embedding`.** Chroma is the source
  of truth for retrieval; SQLite is the durable backup. If `chroma_db/`
  is wiped or corrupted we can rebuild from SQLite without re-running
  the embedder (which is the slow part).
- **Synchronous POST + spinner.** MiniLM is sub-second after warm-up;
  Ollama similar. SSE would buy nothing today; revisit if any single
  build ever feels slow.
- **Fail Ollama lazily, not at startup.** Server boots whether or not
  Ollama is running. 503 only fires when something actually tries to
  use it — keeps dev-iteration cheap when working purely in MiniLM.
- **Module-level `_INSTANCES` cache for embedders.** One instance per
  model per process; MiniLM weights load ~2s on first request, instant
  after. Multi-worker setups would have one cache per worker — fine
  for this scale.
- **Cosine over L2.** Sentence embedders encode meaning in *direction*;
  L2 would over-weight magnitude and score same-meaning-different-length
  sentences as less similar than they are. Set via
  `metadata={"hnsw:space": "cosine"}` on collection creation.
- **`db.commit()` before `upsert_chunks()`.** Originally written the
  other way; flipped on review. If Chroma fails after the commit,
  SQLite is still consistent and a retry just runs again. The reverse
  ordering had a small window where Chroma had vectors that SQLite
  didn't.
- **`str(chunk.id)` as the Chroma row id.** Combined with `upsert`,
  re-running the build for a (doc, cfg) pair overwrites in place
  rather than duplicating. Idempotency falls out of the data model.
- **float32 over float64 in the cache.** 4 bytes/float instead of 8 —
  halves storage with no measurable retrieval impact.
- **`embedded_count` on `ChunksResponse`, not a separate GET.** When
  the UI loads chunks it already has the answer to "is this embedded
  yet?" — no follow-up request needed.
- **Unified embed action inside `ChunksTab`, not a separate tab.**
  Same data, same selectors, same column layout — extending the
  existing tab keeps the workflow continuous (chunk → embed).
- **`EmbedState` as a discriminated union.** TypeScript's exhaustive
  switch protection makes inconsistent states structurally impossible.

### What I learned

- **Embeddings as geometry.** A vector isn't just "a thing the model
  emits" — it's a specific point in a high-dim space where meaning is
  encoded as direction. Same meaning → similar direction → high cosine.
- **Model-specific geometry.** Different models live in different
  spaces; their vectors aren't comparable. "Pin one model per config"
  isn't bureaucracy, it's correctness — proven by direct experiment
  below.
- **Embedded chunks with Ollama, queried with MiniLM by mistake.**
  Hand-rolled `cosine()` happily ran because Python's `zip()` truncates
  silently; results were near-zero noise (the literal substring of a
  chunk scored 0.002 against that chunk). Chroma's `col.query()`
  would have refused with `InvalidDimensionException`. Concrete proof
  of why the higher-level API is more defensive than DIY math.
- **Models calibrate cosine differently.** Same chunks via Nomic vs
  MiniLM produce different absolute scores; Nomic compresses the
  angular range so even unrelated text scores ~0.45. The discriminating
  signal is *relative ranking*, not absolute thresholds. Cross-model
  threshold heuristics don't transfer — eval (Week 7) is what tells you
  which model is actually better for your data.
- **NumPy ndarray vs `list[list[float]]`.** ndarrays are the typed,
  contiguous, fast representation models emit; lists are the
  JSON-serialisable, dep-free representation we expose. `.tolist()`
  is the boundary.
- **Bytes is a storage shape; floats is a compute shape.** Same numbers,
  different container. `struct.pack` and `struct.unpack` round-trip
  with no information loss (modulo float32 quantisation).
- **HuggingFace caching.** First load downloads ~90MB into
  `~/.cache/huggingface/`; every later load on this machine is
  filesystem-only. Same idea as pip wheels or npm packages.
- **Ollama as a separate process.** Runs its own HTTP server on
  `localhost:11434`; we don't load weights into our process. Different
  failure modes (process not running vs model not pulled) surface as
  different exception types.
- **Module-level state and process lifecycle.** `_INSTANCES` lives as
  long as the process; one cached instance per model. `--reload`
  resets it (worker replaced); `--workers N` gives N independent
  caches.
- **ChromaDB collection design.** Collection per config + cosine
  distance + `str(chunk.id)` as the row id encodes the whole "one
  bucket per pipeline that re-runs cleanly" pattern in three small
  decisions.
- **TypeScript discriminated unions for UI state.** Modelling four
  mutually-exclusive UI states as four union members + an exhaustive
  switch makes adding a fifth state a type error in every consumer
  until you handle it.
- **`if TYPE_CHECKING:` import.** Type-only imports at zero runtime
  cost — avoids circular-import risk for the same files.

---

## Week 4 — Retriever + generator 🔜

**Goal:** End-to-end query flow — question in, grounded answer out.

**Claude scaffolds:** `QueryTrace` model, `POST /api/query` route,
frontend query panel with trace viewer.

**I write by hand:** `core/retriever.py` (vector similarity search),
`core/generator.py` (prompt assembly + LLM call).

---

## Week 5 — Trace viewer & comparison ⬜

**Goal:** Inspect every stage of a query (chunks retrieved, prompt built,
LLM output) side-by-side across configs.

---

## Week 6 — Hybrid retrieval + reranking ⬜

**Goal:** BM25 + vector merged results, optional cross-encoder reranker.

---

## Week 7 — Evaluation ⬜

**Goal:** Offline eval harness (precision@k, faithfulness, answer
relevance) comparing configs on a fixed question set.

---

## Week 8 — Agent ⬜

**Goal:** Tool-calling agent that can plan multi-step queries over the
RAG pipeline.

---

## Week 9 — MCP server ⬜

**Goal:** Expose RAGScope as an MCP server so other LLMs can query
pipelines via the protocol.

---

## Week 10 — Polish & writeup ⬜

**Goal:** Docs, demo video, README, deployment notes, retrospective.

---

## Update protocol

When a week finishes:

1. Flip its status from 🚧 → ✅
2. Fill in deliverables, decisions, and "what I learned" the same way as
   Week 1
3. Flip the next week's status to 🔜
4. Keep the format consistent — future me will skim this in one pass
