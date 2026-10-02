"""
RAGScope FastAPI entry point.

Run locally from the repo root:
    .venv/bin/uvicorn backend.main:app --reload

OpenAPI docs will be at http://localhost:8000/docs
"""

# Load .env BEFORE importing any backend module that reads os.environ
# (Gemini SDK in core/generator.py, etc.). dotenv is a no-op if .env
# is missing, so this is safe in environments where vars come from the
# real shell instead.
from dotenv import load_dotenv
load_dotenv()

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes import chunks as chunks_routes
from backend.api.routes import configs as configs_routes
from backend.api.routes import documents as documents_routes
from backend.api.routes import embeddings as embeddings_routes
from backend.db import models  # noqa: F401 — import for side-effect: registers models with Base.metadata
from backend.db.database import Base, engine


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """App lifespan hook — runs once at startup and once at shutdown.

    On startup we create any tables that don't exist yet. SQLAlchemy issues
    `CREATE TABLE IF NOT EXISTS` so this is safe to run every boot.
    """
    Base.metadata.create_all(bind=engine)
    yield
    # nothing to clean up on shutdown yet


app = FastAPI(
    title="RAGScope",
    description="Chrome DevTools for RAG pipelines.",
    version="0.1.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS middleware — must be added BEFORE routers so it wraps every request.
# allow_origins: only our Vite dev server gets cross-origin access.
# allow_methods / allow_headers: ["*"] means any HTTP verb and header is fine.
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount feature routers. Each router already carries its own prefix + tags.
app.include_router(documents_routes.router)
app.include_router(configs_routes.router)
app.include_router(chunks_routes.router)
app.include_router(embeddings_routes.router)


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness probe. Returns 200 with a tiny body if the server is up."""
    return {"status": "ok"}
