"""
Documents API — upload and list.

POST /api/documents/upload   accepts a PDF / TXT / MD file, extracts text,
                             stores a Document row, returns its metadata.

GET  /api/documents          returns a list of all documents (no content).
"""

import os
from datetime import datetime
from io import BytesIO

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, ConfigDict
from pypdf import PdfReader
from sqlalchemy.orm import Session

from backend.db.database import get_db
from backend.db.models import Document

# ---------------------------------------------------------------------------
# APIRouter — a mini-FastAPI you attach routes to, then mount under a prefix
# in main.py via app.include_router(). `tags` groups related routes in
# Swagger UI under one heading.
# ---------------------------------------------------------------------------
router = APIRouter(prefix="/api/documents", tags=["documents"])


# ---------------------------------------------------------------------------
# Pydantic response schemas. These are DIFFERENT from the SQLAlchemy ORM
# model in backend/db/models.py:
#   - ORM model (Document)    = shape of the DB row (includes large `content`)
#   - Pydantic model (below)  = shape of the JSON we return to the client
# Keeping them separate means we can omit `content` from the list response
# (where it'd be huge) without changing the DB.
# ---------------------------------------------------------------------------
class DocumentRead(BaseModel):
    """Returned for a single document upload or individual fetch."""

    id: int
    filename: str
    uploaded_at: datetime

    # Pydantic v2 setting. Tells Pydantic "when given a non-dict object,
    # read fields via attribute access (e.g. doc.filename)." This is how
    # we hand a SQLAlchemy Document straight to FastAPI and have it
    # serialise correctly.
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md"}


def _extract_pdf_text(raw_bytes: bytes) -> str:
    """Read every page of a PDF and concatenate the extracted text."""
    reader = PdfReader(BytesIO(raw_bytes))
    pages = [(page.extract_text() or "") for page in reader.pages]
    return "\n\n".join(pages)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.post(
    "/upload",
    response_model=DocumentRead,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a PDF/TXT/MD document and extract its text",
)
async def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> Document:
    """Accept a file, extract its text, persist a Document row, return it."""

    # 1. Validate filename + extension
    if not file.filename:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="filename missing")

    ext = os.path.splitext(file.filename.lower())[1]
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"unsupported file type {ext!r}; allowed: {sorted(ALLOWED_EXTENSIONS)}",
        )

    # 2. Read bytes off the wire
    raw = await file.read()
    if not raw:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="empty file")

    # 3. Extract text per type
    try:
        if ext == ".pdf":
            content = _extract_pdf_text(raw)
        else:  # .txt or .md
            content = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"file is not valid UTF-8: {e}",
        ) from e
    except Exception as e:  # pypdf parse errors, etc.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"failed to extract text: {e}",
        ) from e

    if not content.strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="file contains no extractable text",
        )

    # 4. Persist
    doc = Document(filename=file.filename, content=content)
    db.add(doc)
    db.commit()
    db.refresh(doc)  # pull server-generated uploaded_at back into the Python object
    return doc


@router.get("", response_model=list[DocumentRead], summary="List all uploaded documents")
async def list_documents(db: Session = Depends(get_db)) -> list[Document]:
    """Return every document, newest first. Excludes the large `content` field."""
    return (
        db.query(Document)
        .order_by(Document.uploaded_at.desc())
        .all()
    )
