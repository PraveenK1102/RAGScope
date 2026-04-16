/**
 * Typed API client for RAGScope.
 *
 * All backend calls go through these functions — keeps base URL in one place
 * and gives every caller a TypeScript type for free.
 *
 * The BASE_URL reads from an env variable so you can point at a staging server
 * without touching code. Vite exposes VITE_* vars from a .env file.
 * Falls back to localhost:8000 for local dev.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Shared helper — throws a descriptive Error if the response is not 2xx.
// ---------------------------------------------------------------------------
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    // FastAPI returns { detail: "..." } for errors — surface that message.
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Types — mirror the Pydantic response schemas from the backend.
// These are kept intentionally flat (no class, just plain interfaces) so
// they're trivial to serialize/deserialize and easy to extend.
// ---------------------------------------------------------------------------
export interface Document {
  id: number;
  filename: string;
  uploaded_at: string; // ISO-8601 string; convert with new Date(doc.uploaded_at)
}

export type ChunkStrategy = "fixed" | "recursive" | "semantic";
export type EmbeddingModel = "ollama-nomic-embed-text" | "all-MiniLM-L6-v2";
export type RetrievalMode = "vector" | "bm25" | "hybrid";

export interface Config {
  id: number;
  name: string;
  chunk_strategy: ChunkStrategy;
  chunk_size: number;
  chunk_overlap: number;
  embedding_model: EmbeddingModel;
  top_k: number;
  retrieval_mode: RetrievalMode;
  reranking_enabled: boolean;
  prompt_template: string;
}

export interface ConfigCreate {
  name: string;
  chunk_strategy: ChunkStrategy;
  chunk_size: number;
  chunk_overlap: number;
  embedding_model: EmbeddingModel;
  top_k?: number; // optional — backend defaults to 5
}

// ---------------------------------------------------------------------------
// Documents API
// ---------------------------------------------------------------------------

/** Fetch the list of all uploaded documents (newest first). */
export async function listDocuments(): Promise<Document[]> {
  return apiFetch<Document[]>("/api/documents");
}

/**
 * Upload a file to the backend.
 * Uses FormData / multipart — cannot go through the JSON helper above.
 */
export async function uploadDocument(file: File): Promise<Document> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${BASE_URL}/api/documents/upload`, {
    method: "POST",
    body: form,
    // Do NOT set Content-Type manually — the browser sets it with the boundary.
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<Document>;
}

// ---------------------------------------------------------------------------
// Configs API
// ---------------------------------------------------------------------------

/** Fetch every config (most recent first). */
export async function listConfigs(): Promise<Config[]> {
  return apiFetch<Config[]>("/api/configs");
}

/** Fetch one config by id — throws if 404. */
export async function getConfig(id: number): Promise<Config> {
  return apiFetch<Config>(`/api/configs/${id}`);
}

/** Create a new config. Returns the persisted Config with server defaults filled in. */
export async function createConfig(payload: ConfigCreate): Promise<Config> {
  return apiFetch<Config>("/api/configs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
