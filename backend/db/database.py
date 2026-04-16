"""
SQLAlchemy engine, session factory, and declarative Base.

The DB file lives at the repo root as `ragscope.db`. Override with the
RAGSCOPE_DB_URL env var if you need a different location (useful for tests).
"""

import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

# ---------------------------------------------------------------------------
# Engine: the connection pool. For SQLite we disable the same-thread check
# because FastAPI runs sync request handlers in a thread pool, and SQLAlchemy's
# default is to refuse a connection reused across threads.
# ---------------------------------------------------------------------------
DATABASE_URL = os.getenv("RAGSCOPE_DB_URL", "sqlite:///./ragscope.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)

# ---------------------------------------------------------------------------
# SessionLocal: a factory. Call SessionLocal() to get a new Session object.
# autocommit=False + autoflush=False means you control when changes are
# flushed to the DB (via session.commit() / session.flush()). This is the
# SQLAlchemy 2.x recommended default.
# ---------------------------------------------------------------------------
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


# ---------------------------------------------------------------------------
# Base: every ORM model inherits from this. SQLAlchemy 2.x style uses a class
# that subclasses DeclarativeBase (instead of the old declarative_base()).
# ---------------------------------------------------------------------------
class Base(DeclarativeBase):
    """Declarative base for all RAGScope ORM models."""


# ---------------------------------------------------------------------------
# FastAPI dependency. Use in routes as:
#
#     @router.post("/")
#     def create_thing(payload: ..., db: Session = Depends(get_db)):
#         ...
#
# The `yield` hands the session to the route; the `finally` closes it no
# matter how the route exits (success or exception).
# ---------------------------------------------------------------------------
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
