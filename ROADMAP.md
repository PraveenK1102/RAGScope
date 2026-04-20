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

## Week 3 — Embedder + vector store 🔜

**Goal:** Embed chunks and persist them to a vector store, with two model
options (Ollama nomic-embed-text, all-MiniLM-L6-v2).

**Claude scaffolds:** Chroma setup, `POST /api/embeddings/build` route,
frontend progress indicator.

**I write by hand:** `core/embedder.py` with two backends, upsert into
Chroma, handling dimension mismatch between models.

---

## Week 4 — Retriever + generator ⬜

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
