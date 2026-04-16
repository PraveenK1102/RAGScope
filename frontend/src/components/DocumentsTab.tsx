/**
 * DocumentsTab — list of uploaded documents.
 *
 * Behaviour:
 *   1. On mount, fetch /api/documents and store the list in state.
 *   2. While the request is in flight, show a "loading..." placeholder.
 *   3. If the request fails, show the error message (in red).
 *   4. If the list is empty, show an "empty state" nudge.
 *   5. Otherwise, render each document as a row.
 *
 * Upload UI comes in the next piece.
 */

import { useEffect, useState } from "react";

import { listDocuments, uploadDocument, type Document } from "../api/client";
import UploadZone from "./UploadZone";

export default function DocumentsTab() {
  // Three pieces of state cover every render path:
  //   docs     — the current list (starts empty)
  //   loading  — true until the first fetch resolves (success OR failure)
  //   error    — non-null if the fetch threw; cleared on retry
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload state — kept separate from the list's loading/error so the two
  // flows don't interfere. A failed upload shouldn't nuke the existing list.
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // useEffect with an empty dep array [] = "run exactly once, after first render".
  // This is where side effects (fetch, subscriptions, etc.) belong in React.
  useEffect(() => {
    listDocuments()
      .then((data) => setDocs(data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Upload handler — passed down to <UploadZone>. On success we prepend the
  // new document so the user sees it at the top of the list without a refetch.
  async function handleUpload(file: File): Promise<void> {
    setUploading(true);
    setUploadError(null);
    try {
      const doc = await uploadDocument(file);
      setDocs((prev) => [doc, ...prev]); // newest first matches backend ordering
    } catch (e) {
      setUploadError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <section>
      <header className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold">Documents</h2>
        <span className="text-xs text-gray-400">
          {loading ? "loading..." : `${docs.length} total`}
        </span>
      </header>

      {/* Upload zone always renders — it's how users add new docs. */}
      <div className="mb-6">
        <UploadZone onFile={handleUpload} uploading={uploading} />
        {uploadError && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            Upload failed: {uploadError}
          </div>
        )}
      </div>

      {/* List fetch error banner — only rendered if error !== null */}
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load documents: {error}
        </div>
      )}

      {/* Render exactly one of: loading skeleton / empty state / list */}
      {loading ? (
        <LoadingSkeleton />
      ) : docs.length === 0 ? (
        <EmptyState />
      ) : (
        <DocumentList docs={docs} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tiny presentational sub-components. Kept in this file because they're only
// used here — moving them to their own files would be premature.
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  // Three grey bars that pulse via Tailwind's animate-pulse. Cheap skeleton UI.
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-12 rounded-md bg-gray-200 animate-pulse" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
      <p className="text-sm text-gray-500">
        No documents uploaded yet.
      </p>
    </div>
  );
}

function DocumentList({ docs }: { docs: Document[] }) {
  return (
    <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
      {docs.map((doc) => (
        <li
          key={doc.id}
          className="flex items-center justify-between px-4 py-3"
        >
          <div>
            <p className="text-sm font-medium">{doc.filename}</p>
            <p className="text-xs text-gray-400">id: {doc.id}</p>
          </div>
          <time
            className="text-xs text-gray-500"
            // ISO string looks ugly in the UI — format it to a local date/time.
            title={doc.uploaded_at}
          >
            {new Date(doc.uploaded_at).toLocaleString()}
          </time>
        </li>
      ))}
    </ul>
  );
}
