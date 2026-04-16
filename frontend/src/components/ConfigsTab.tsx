/**
 * ConfigsTab — list of RAG pipeline configurations.
 *
 * Mirrors DocumentsTab:
 *   - fetch /api/configs on mount
 *   - show loading skeleton → empty state → list
 *   - a "New config" button toggles a form (wired in the next piece)
 *
 * Why a toggle instead of always-on form?
 *   A full config form has ~6 fields. Forcing it to always render wastes
 *   vertical space on the list view, which is the more common case once
 *   a user has a few configs.
 */

import { useEffect, useState } from "react";

import { listConfigs, type Config } from "../api/client";
import ConfigForm from "./ConfigForm";

export default function ConfigsTab() {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Visible when the user clicks "New config".
  // The form itself will be added in the next piece — for now it's a stub.
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    listConfigs()
      .then((data) => setConfigs(data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Will be passed to <ConfigForm> as its success callback in the next piece.
  // Prepending keeps ordering consistent with the backend (ORDER BY id DESC).
  function handleCreated(newConfig: Config): void {
    setConfigs((prev) => [newConfig, ...prev]);
    setShowForm(false); // close form on success
  }

  return (
    <section>
      <header className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold">Pipeline Configs</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            {loading ? "loading..." : `${configs.length} total`}
          </span>
          <button
            onClick={() => setShowForm((prev) => !prev)}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
          >
            {showForm ? "Cancel" : "+ New config"}
          </button>
        </div>
      </header>

      {showForm && (
        <div className="mb-6 rounded-md border border-gray-200 bg-white px-5 py-4">
          <ConfigForm onCreated={handleCreated} />
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load configs: {error}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : configs.length === 0 ? (
        <EmptyState />
      ) : (
        <ConfigList configs={configs} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 rounded-md bg-gray-200 animate-pulse" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
      <p className="text-sm text-gray-500">
        No configs yet — click "+ New config" to create your first one.
      </p>
    </div>
  );
}

function ConfigList({ configs }: { configs: Config[] }) {
  return (
    <ul className="divide-y divide-gray-200 rounded-md border border-gray-200 bg-white">
      {configs.map((cfg) => (
        <li key={cfg.id} className="px-4 py-3">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">{cfg.name}</p>
            <span className="text-xs text-gray-400">id: {cfg.id}</span>
          </div>
          {/* Compact summary of the config's most meaningful fields */}
          <p className="mt-1 text-xs text-gray-500">
            <Badge>{cfg.chunk_strategy}</Badge>
            <span className="mx-1">·</span>
            size {cfg.chunk_size}/overlap {cfg.chunk_overlap}
            <span className="mx-1">·</span>
            <Badge>{cfg.embedding_model}</Badge>
            <span className="mx-1">·</span>
            top-k {cfg.top_k}
          </p>
        </li>
      ))}
    </ul>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono text-gray-600">
      {children}
    </span>
  );
}
