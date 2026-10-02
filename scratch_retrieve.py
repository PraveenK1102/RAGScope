# scratch_retrieve.py — sanity check the retriever across a few questions.
from backend.db.database import SessionLocal
from backend.db.models import Config
from backend.core.retriever import retrieve

db = SessionLocal()
config = db.get(Config, 7)

questions = [
    "what was the receipt amount",        # on-topic
    "how do I cook biryani",              # totally unrelated
    "CONTACT US 040-67607600",            # near-exact substring of chunk 0
]

for question in questions:
    print(f"\n=== Q: {question!r} ===")
    results = retrieve(question, config)
    for r in results:
        text = r.content[:80].replace("\n", " ")
        print(f"  distance={r.distance:.3f}  doc={r.document_id} chunk_idx={r.chunk_index}")
        print(f"    {text}...")
