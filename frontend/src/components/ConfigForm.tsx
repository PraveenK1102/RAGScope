/**
 * ConfigForm — create a new RAG pipeline config.
 *
 * Inputs mirror the Pydantic ConfigCreate schema on the backend:
 *   name            text      1..256 chars
 *   chunk_strategy  dropdown  fixed | recursive | semantic
 *   chunk_size      slider    1..4096
 *   chunk_overlap   slider    0..1024  AND  < chunk_size
 *   embedding_model dropdown  ollama-nomic | minilm
 *   top_k           slider    1..100
 *
 * Client-side validation prevents the obviously-bad case (overlap >= size).
 * Everything else we trust the backend to reject with a 422 — the error is
 * surfaced via the `error` state just below the form.
 */

import { useState } from "react";

import {
  createConfig,
  type ChunkStrategy,
  type Config,
  type ConfigCreate,
  type EmbeddingModel,
} from "../api/client";

interface Props {
  onCreated: (config: Config) => void;
}

// Sensible defaults so the form has usable values on first open.
const DEFAULTS: ConfigCreate = {
  name: "",
  chunk_strategy: "recursive",
  chunk_size: 512,
  chunk_overlap: 64,
  embedding_model: "all-MiniLM-L6-v2",
  top_k: 5,
};

export default function ConfigForm({ onCreated }: Props) {
  // One object of state is simpler than six useState calls and keeps the form
  // shape identical to what we POST.
  const [values, setValues] = useState<ConfigCreate>(DEFAULTS);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cross-field validation rule (same as the backend's model_validator).
  const overlapTooLarge =
    values.chunk_overlap >= values.chunk_size;

  const nameInvalid = values.name.trim().length === 0;

  const canSubmit = !submitting && !overlapTooLarge && !nameInvalid;

  // Generic setter — lets every input call setField("chunk_size", 512) etc.
  // The generic <K extends keyof ConfigCreate> gives TypeScript enough info
  // to know that value's type must match the field's type.
  function setField<K extends keyof ConfigCreate>(
    key: K,
    value: ConfigCreate[K],
  ): void {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault(); // stop the browser from reloading the page
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      const created = await createConfig(values);
      onCreated(created);         // parent closes the form + prepends to list
      setValues(DEFAULTS);        // reset for the next create
    } catch (ex) {
      setError((ex as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Name --------------------------------------------------------- */}
      <Field label="Name">
        <input
          type="text"
          value={values.name}
          onChange={(e) => setField("name", e.target.value)}
          maxLength={256}
          placeholder="e.g. recursive-512"
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
        />
      </Field>

      {/* Chunking strategy ------------------------------------------- */}
      <Field label="Chunk strategy">
        <select
          value={values.chunk_strategy}
          onChange={(e) =>
            setField("chunk_strategy", e.target.value as ChunkStrategy)
          }
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
        >
          <option value="fixed">fixed — split every N chars</option>
          <option value="recursive">
            recursive — LangChain RecursiveCharacterTextSplitter
          </option>
          <option value="semantic">
            semantic — LangChain SemanticChunker (embedding-based)
          </option>
        </select>
      </Field>

      {/* Chunk size + overlap (two sliders side-by-side on wide) ----- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={`Chunk size: ${values.chunk_size}`}>
          <input
            type="range"
            min={64}
            max={4096}
            step={32}
            value={values.chunk_size}
            onChange={(e) => setField("chunk_size", Number(e.target.value))}
            className="w-full accent-indigo-600"
          />
        </Field>

        <Field label={`Chunk overlap: ${values.chunk_overlap}`}>
          <input
            type="range"
            min={0}
            max={1024}
            step={8}
            value={values.chunk_overlap}
            onChange={(e) =>
              setField("chunk_overlap", Number(e.target.value))
            }
            className="w-full accent-indigo-600"
          />
        </Field>
      </div>

      {/* Cross-field error — only appears when the rule is violated. */}
      {overlapTooLarge && (
        <p className="text-xs text-red-600">
          Chunk overlap ({values.chunk_overlap}) must be less than chunk size
          ({values.chunk_size}).
        </p>
      )}

      {/* Embedding model -------------------------------------------- */}
      <Field label="Embedding model">
        <select
          value={values.embedding_model}
          onChange={(e) =>
            setField("embedding_model", e.target.value as EmbeddingModel)
          }
          className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
        >
          <option value="all-MiniLM-L6-v2">
            all-MiniLM-L6-v2 (384 dims, via sentence-transformers)
          </option>
          <option value="ollama-nomic-embed-text">
            ollama-nomic-embed-text (768 dims, via Ollama)
          </option>
        </select>
      </Field>

      {/* top_k --------------------------------------------------------- */}
      <Field label={`Top K: ${values.top_k ?? 5}`}>
        <input
          type="range"
          min={1}
          max={100}
          step={1}
          value={values.top_k ?? 5}
          onChange={(e) => setField("top_k", Number(e.target.value))}
          className="w-full accent-indigo-600"
        />
      </Field>

      {/* Server-side error banner ----------------------------------- */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Submit ------------------------------------------------------ */}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-300 transition-colors"
        >
          {submitting ? "Creating..." : "Create config"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Tiny label+input wrapper. Keeps markup consistent without inventing a
// full form library.
// ---------------------------------------------------------------------------
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">
        {label}
      </span>
      {children}
    </label>
  );
}
