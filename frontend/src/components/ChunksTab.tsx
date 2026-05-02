/**
 * ChunksTab — unified chunk viewer.
 *
 * One document + up to 3 configs. Renders 1–3 columns side-by-side so the
 * user can eyeball the "visual diff" of different strategies applied to the
 * same document (Week 2 deliverable).
 *
 * Data flow:
 *   1. On mount, fetch documents and configs (for the pickers).
 *   2. User picks one document and ticks 1–3 configs.
 *   3. "Load chunks" fires `fetchChunks` in parallel for each selected config
 *      via Promise.allSettled — a failure in one column doesn't hide the
 *      other two (useful when one config points at a slow or broken strategy).
 *   4. Render a responsive grid: 1 column for 1 result, up to 3 columns on
 *      medium screens.
 *
 * Boundary highlighting on the source doc is still pending — that's the
 * last "together" step of Week 2.
 */

import { useEffect, useState } from "react";

import {
  buildEmbeddings,
  fetchChunks,
  getDocument,
  listConfigs,
  listDocuments,
  type Chunk,
  type ChunksResponse,
  type Config,
  type Document,
  type DocumentDetail,
} from "../api/client";

const MAX_SELECTED_CONFIGS = 3;

// Per-column embedding state. Discriminated union → exhaustive switch in
// EmbedActionRow, no "what if status is X but error is also set" ambiguity.
//   idle    — chunks exist but no embeddings yet (show "Build" button)
//   loading — POST in flight (show spinner)
//   success — embeddings persisted (show "✓ embedded" + "Rebuild" link)
//   error   — last attempt failed (show message + retry)
type EmbedState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success" }
  | { status: "error"; error: string };

// Result of a single fetch, bundled with the source config so the column
// header can render its name regardless of whether the fetch succeeded.
type ColumnResult = {
  config: Config;
  data: ChunksResponse | null;
  error: string | null;
  embed: EmbedState;
};

export default function ChunksTab() {
  // Picker sources — fetched once on mount.
  const [docs, setDocs] = useState<Document[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [listsError, setListsError] = useState<string | null>(null);

  // Selections.
  const [docId, setDocId] = useState<number | null>(null);
  const [configIds, setConfigIds] = useState<number[]>([]);

  // Results of the current comparison.
  const [columns, setColumns] = useState<ColumnResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Full source text for the loaded document — powers the highlight panel.
  // Cleared whenever columns are cleared; only populated when a load succeeds.
  const [sourceDoc, setSourceDoc] = useState<DocumentDetail | null>(null);

  // Which of the loaded columns' highlights to render on the source doc.
  // Set to the first selected config on load; user can switch via tabs.
  const [highlightConfigId, setHighlightConfigId] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([listDocuments(), listConfigs()])
      .then(([d, c]) => {
        setDocs(d);
        setConfigs(c);
      })
      .catch((e: Error) => setListsError(e.message))
      .finally(() => setListsLoading(false));
  }, []);

  function toggleConfig(id: number): void {
    setConfigIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SELECTED_CONFIGS) return prev;
      return [...prev, id];
    });
  }

  async function handleLoad(): Promise<void> {
    if (docId == null || configIds.length === 0) return;

    const selectedConfigs = configIds
      .map((id) => configs.find((c) => c.id === id))
      .filter((c): c is Config => c != null);

    setLoading(true);
    setColumns([]);
    setSourceDoc(null);
    setHighlightConfigId(null);

    // Fetch source doc in parallel with the chunk requests. allSettled so one
    // failing config (or a missing doc content) doesn't poison the others.
    const [docOutcome, ...chunkOutcomes] = await Promise.allSettled([
      getDocument(docId),
      ...selectedConfigs.map((c) => fetchChunks(docId, c.id)),
    ]);

    const results: ColumnResult[] = chunkOutcomes.map((outcome, i) => {
      const data = outcome.status === "fulfilled" ? outcome.value : null;
      const error = outcome.status === "rejected" ? (outcome.reason as Error).message : null;
      // Already-embedded pairs come back with embedded_count == total_chunks;
      // start them in the success state so the column shows "✓ embedded"
      // immediately rather than re-prompting a build.
      const embed: EmbedState =
        data && data.total_chunks > 0 && data.embedded_count === data.total_chunks
          ? { status: "success" }
          : { status: "idle" };
      return { config: selectedConfigs[i], data, error, embed };
    });

    setColumns(results);
    if (docOutcome.status === "fulfilled") {
      setSourceDoc(docOutcome.value);
      // Default to highlighting the first config that returned chunks.
      const firstOk = results.find((r) => r.data != null);
      setHighlightConfigId(firstOk ? firstOk.config.id : null);
    }
    setLoading(false);
  }

  /**
   * Trigger embedding for one column. Updates only that column's embed
   * state — the others stay untouched, so two builds can run in parallel
   * if the user clicks both.
   */
  async function handleBuild(configId: number, documentId: number): Promise<void> {
    const setEmbed = (next: EmbedState): void =>
      setColumns((prev) =>
        prev.map((c) => (c.config.id === configId ? { ...c, embed: next } : c)),
      );

    setEmbed({ status: "loading" });
    try {
      await buildEmbeddings(documentId, configId);
      setEmbed({ status: "success" });
    } catch (e) {
      setEmbed({ status: "error", error: (e as Error).message });
    }
  }

  const canLoad = docId != null && configIds.length > 0 && !loading;

  return (
    <section>
      <header className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold">Chunk Viewer</h2>
        <span className="text-xs text-gray-400">
          {listsLoading ? "loading lists..." : `${docs.length} docs · ${configs.length} configs`}
        </span>
      </header>

      {listsError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load documents/configs: {listsError}
        </div>
      )}

      {/* Picker panel ------------------------------------------------------ */}
      <div className="mb-6 rounded-md border border-gray-200 bg-white px-5 py-4 space-y-4">
        <Select
          label="Document"
          disabled={listsLoading || docs.length === 0}
          value={docId}
          onChange={setDocId}
          options={docs.map((d) => ({ value: d.id, label: `${d.filename} (id ${d.id})` }))}
          placeholder={docs.length === 0 ? "No documents uploaded yet" : "Select a document…"}
        />

        <ConfigChecklist
          configs={configs}
          selected={configIds}
          onToggle={toggleConfig}
          disabledSource={listsLoading}
        />

        <div className="flex items-center justify-between pt-1">
          <p className="text-xs text-gray-500">
            First load for a new (doc, config) pair materialises chunks on the backend —
            may take a few seconds for the <code className="font-mono">semantic</code> strategy.
            Subsequent loads are cached.
          </p>
          <button
            onClick={handleLoad}
            disabled={!canLoad}
            className={[
              "rounded-md px-4 py-2 text-sm font-medium transition-colors shrink-0 ml-4",
              canLoad
                ? "bg-indigo-600 text-white hover:bg-indigo-500"
                : "bg-gray-200 text-gray-400 cursor-not-allowed",
            ].join(" ")}
          >
            {loading ? "Loading…" : `Load chunks${configIds.length > 1 ? " (compare)" : ""}`}
          </button>
        </div>
      </div>

      {/* Results area ------------------------------------------------------ */}
      {loading && <LoadingSkeleton columnCount={configIds.length} />}
      {!loading && columns.length > 0 && (
        <ColumnsGrid columns={columns} onBuild={handleBuild} />
      )}
      {!loading && columns.length === 0 && !listsError && <EmptyState />}

      {!loading && sourceDoc && columns.some((c) => c.data != null) && (
        <SourceDocumentPanel
          doc={sourceDoc}
          columns={columns}
          highlightConfigId={highlightConfigId}
          onSelectConfig={setHighlightConfigId}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  options: { value: number; label: string }[];
  placeholder: string;
  disabled: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-500 mb-1">{label}</span>
      <select
        disabled={disabled}
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? null : Number(v));
        }}
        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400"
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ConfigChecklist({
  configs,
  selected,
  onToggle,
  disabledSource,
}: {
  configs: Config[];
  selected: number[];
  onToggle: (id: number) => void;
  disabledSource: boolean;
}) {
  const atCap = selected.length >= MAX_SELECTED_CONFIGS;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-medium text-gray-500">
          Configs (pick up to {MAX_SELECTED_CONFIGS})
        </span>
        <span className="text-xs text-gray-400">
          {selected.length} / {MAX_SELECTED_CONFIGS} selected
        </span>
      </div>

      {configs.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-500">
          No configs yet — create one in the Configs tab.
        </div>
      ) : (
        <ul className="rounded-md border border-gray-200 bg-white divide-y divide-gray-100 max-h-64 overflow-auto">
          {configs.map((cfg) => {
            const isChecked = selected.includes(cfg.id);
            const isDisabled = disabledSource || (!isChecked && atCap);
            return (
              <li key={cfg.id}>
                <label
                  className={[
                    "flex items-center gap-3 px-3 py-2 text-sm cursor-pointer",
                    isDisabled && !isChecked ? "opacity-50 cursor-not-allowed" : "hover:bg-gray-50",
                  ].join(" ")}
                >
                  <input
                    type="checkbox"
                    disabled={isDisabled}
                    checked={isChecked}
                    onChange={() => onToggle(cfg.id)}
                    className="accent-indigo-600"
                  />
                  <span className="font-medium">{cfg.name}</span>
                  <ConfigMeta config={cfg} />
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results rendering
// ---------------------------------------------------------------------------

function ColumnsGrid({
  columns,
  onBuild,
}: {
  columns: ColumnResult[];
  onBuild: (configId: number, documentId: number) => void;
}) {
  // Explicit per-count classes keep Tailwind's JIT happy (it won't generate
  // classes from interpolated strings like `grid-cols-${n}`).
  const gridCls =
    columns.length === 1
      ? "grid-cols-1"
      : columns.length === 2
      ? "grid-cols-1 md:grid-cols-2"
      : "grid-cols-1 md:grid-cols-3";

  return (
    <div className={`grid ${gridCls} gap-4`}>
      {columns.map((col) => (
        <ChunksColumn key={col.config.id} column={col} onBuild={onBuild} />
      ))}
    </div>
  );
}

function ChunksColumn({
  column,
  onBuild,
}: {
  column: ColumnResult;
  onBuild: (configId: number, documentId: number) => void;
}) {
  const { config, data, error, embed } = column;
  return (
    <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <p className="text-sm font-medium truncate" title={config.name}>
          {config.name}
        </p>
        <div className="mt-1">
          <ConfigMeta config={config} />
        </div>
        {data && (
          <p className="mt-2 text-xs text-gray-600">
            <b className="text-gray-900">{data.total_chunks}</b> chunks · avg{" "}
            <b className="text-gray-900">{data.avg_char_count}</b> chars
          </p>
        )}
        {data && data.total_chunks > 0 && (
          <div className="mt-2">
            <EmbedActionRow
              embed={embed}
              onBuild={() => onBuild(config.id, data.document_id)}
            />
          </div>
        )}
      </div>

      <div className="p-3">
        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}
        {data && data.chunks.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-6">
            0 chunks produced.
          </p>
        )}
        {data && data.chunks.length > 0 && (
          <ul className="space-y-2">
            {data.chunks.map((c) => (
              <ChunkRow key={c.chunk_index} chunk={c} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Per-column embed action area.
 *
 * Renders one of four mutually-exclusive UI states based on the
 * EmbedState discriminated union. The build/rebuild buttons are the
 * only thing that calls into onBuild — the parent owns everything else.
 */
function EmbedActionRow({
  embed,
  onBuild,
}: {
  embed: EmbedState;
  onBuild: () => void;
}) {
  switch (embed.status) {
    case "idle":
      return (
        <button
          onClick={onBuild}
          className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
        >
          Build embeddings
        </button>
      );

    case "loading":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
          <span className="inline-block h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
          embedding…
        </span>
      );

    case "success":
      return (
        <span className="inline-flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 font-medium text-green-700">
            <span aria-hidden>✓</span> embedded
          </span>
          <button
            onClick={onBuild}
            className="text-gray-500 hover:text-gray-900 underline"
          >
            rebuild
          </button>
        </span>
      );

    case "error":
      return (
        <div className="space-y-1">
          <p className="text-xs text-red-700">Embed failed: {embed.error}</p>
          <button
            onClick={onBuild}
            className="rounded border border-red-300 bg-white px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
          >
            Retry
          </button>
        </div>
      );
  }
}

function ChunkRow({ chunk }: { chunk: Chunk }) {
  return (
    <li className="rounded border border-gray-200 px-3 py-2">
      <div className="flex items-baseline justify-between mb-1 text-xs">
        <span className="font-medium text-gray-500">#{chunk.chunk_index}</span>
        <span className="text-gray-400 font-mono">
          {chunk.start_char}–{chunk.end_char} · {chunk.char_count}ch
        </span>
      </div>
      <p className="text-xs text-gray-800 whitespace-pre-wrap font-mono max-h-96 overflow-auto">
        {chunk.content}
      </p>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Source document panel — renders the original text with chunk-boundary
// overlays for the currently selected config.
// ---------------------------------------------------------------------------

// Six distinct pastel palette entries. Chunks cycle through these so that
// adjacent chunks are always visually distinguishable even for long docs
// with many chunks.
const CHUNK_COLORS = [
  "bg-blue-100",
  "bg-purple-100",
  "bg-green-100",
  "bg-amber-100",
  "bg-pink-100",
  "bg-teal-100",
];

type Segment = {
  start: number;
  end: number;
  text: string;
  owners: number[]; // chunk indices that contain this segment (0, 1, 2+)
};

/**
 * Walk every unique boundary position of every chunk, then emit one Segment
 * per run of characters that share the same set of owners. A segment with
 *   owners.length === 0   → plain text (outside any chunk — shouldn't happen)
 *   owners.length === 1   → solid color fill for that chunk
 *   owners.length >= 2    → overlap region — dashed border, no fill
 */
function segmentText(text: string, chunks: Chunk[]): Segment[] {
  if (chunks.length === 0) return [{ start: 0, end: text.length, text, owners: [] }];

  const boundaries = new Set<number>([0, text.length]);
  for (const c of chunks) {
    boundaries.add(c.start_char);
    boundaries.add(c.end_char);
  }
  const sorted = [...boundaries].sort((a, b) => a - b);

  const segs: Segment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start === end) continue;
    const owners = chunks
      .filter((c) => c.start_char <= start && end <= c.end_char)
      .map((c) => c.chunk_index);
    segs.push({ start, end, text: text.slice(start, end), owners });
  }
  return segs;
}

function SourceDocumentPanel({
  doc,
  columns,
  highlightConfigId,
  onSelectConfig,
}: {
  doc: DocumentDetail;
  columns: ColumnResult[];
  highlightConfigId: number | null;
  onSelectConfig: (id: number) => void;
}) {
  const highlighted = columns.find((c) => c.config.id === highlightConfigId && c.data != null);
  const segments = highlighted
    ? segmentText(doc.content, highlighted.data!.chunks)
    : [{ start: 0, end: doc.content.length, text: doc.content, owners: [] as number[] }];

  const loadableColumns = columns.filter((c) => c.data != null);

  return (
    <div className="mt-6 rounded-md border border-gray-200 bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-200 bg-gray-50 flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-medium">Source: {doc.filename}</p>
          <p className="text-xs text-gray-500">{doc.content.length} chars</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Highlight for:</span>
          <div className="flex gap-1 rounded-md bg-gray-100 p-1">
            {loadableColumns.map((col) => {
              const active = col.config.id === highlightConfigId;
              return (
                <button
                  key={col.config.id}
                  onClick={() => onSelectConfig(col.config.id)}
                  className={[
                    "px-3 py-1 rounded text-xs font-medium transition-colors",
                    active ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600 hover:text-gray-900",
                  ].join(" ")}
                >
                  {col.config.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="p-5">
        <p className="mb-3 text-xs text-gray-500 flex gap-4 flex-wrap items-center">
          <LegendSwatch color="bg-blue-100" /> one chunk
          <LegendSwatch border="dashed" /> overlap (multiple chunks)
        </p>
        <pre className="text-xs leading-6 whitespace-pre-wrap font-mono break-words text-gray-800">
          {segments.map((seg) => (
            <SegmentSpan key={`${seg.start}-${seg.end}`} segment={seg} />
          ))}
        </pre>
      </div>
    </div>
  );
}

function SegmentSpan({ segment }: { segment: Segment }) {
  if (segment.owners.length === 0) {
    return <span>{segment.text}</span>;
  }
  if (segment.owners.length === 1) {
    const color = CHUNK_COLORS[segment.owners[0] % CHUNK_COLORS.length];
    return (
      <span
        className={`${color} rounded-sm`}
        title={`chunk #${segment.owners[0]} · chars ${segment.start}–${segment.end}`}
      >
        {segment.text}
      </span>
    );
  }
  // 2+ owners → overlap. Dashed border, no fill.
  return (
    <span
      className="border border-dashed border-red-400 rounded-sm"
      title={`overlap: chunks ${segment.owners.join(", ")} · chars ${segment.start}–${segment.end}`}
    >
      {segment.text}
    </span>
  );
}

function LegendSwatch({ color, border }: { color?: string; border?: "dashed" }) {
  const cls = color
    ? `${color} rounded-sm`
    : `border ${border === "dashed" ? "border-dashed" : "border-solid"} border-red-400 rounded-sm`;
  return <span className={`inline-block w-4 h-3 align-middle mr-1 ${cls}`} />;
}

// ---------------------------------------------------------------------------
// Placeholder states
// ---------------------------------------------------------------------------

function LoadingSkeleton({ columnCount }: { columnCount: number }) {
  const n = Math.max(1, Math.min(columnCount, MAX_SELECTED_CONFIGS));
  const gridCls =
    n === 1 ? "grid-cols-1" : n === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1 md:grid-cols-3";

  return (
    <div className={`grid ${gridCls} gap-4`}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="rounded-md border border-gray-200 bg-white p-3 space-y-2">
          <div className="h-10 rounded bg-gray-200 animate-pulse" />
          <div className="h-16 rounded bg-gray-200 animate-pulse" />
          <div className="h-16 rounded bg-gray-200 animate-pulse" />
          <div className="h-16 rounded bg-gray-200 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
      <p className="text-sm text-gray-500">
        Pick a document and 1–3 configs, then click <b>Load chunks</b>.
      </p>
    </div>
  );
}

/**
 * Compact "strategy · size/overlap" line used in the checklist and column
 * headers. For the semantic strategy, size/overlap are rendered struck-through
 * with a tooltip explaining that the splitter ignores them.
 */
function ConfigMeta({ config }: { config: Config }) {
  const sizeIgnored = config.chunk_strategy === "semantic";
  const sizeText = `size ${config.chunk_size}/overlap ${config.chunk_overlap}`;
  return (
    <span className="text-xs text-gray-500">
      <Badge>{config.chunk_strategy}</Badge>
      <span className="mx-1">·</span>
      {sizeIgnored ? (
        <>
          <span
            className="line-through text-gray-400"
            title="Semantic chunking decides boundaries by embedding similarity — size/overlap are ignored"
          >
            {sizeText}
          </span>
          <span className="ml-2 italic text-gray-400">not considered</span>
        </>
      ) : (
        sizeText
      )}
    </span>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-600">
      {children}
    </span>
  );
}
