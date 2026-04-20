/**
 * App.tsx — top-level shell for RAGScope.
 *
 * Structure:
 *   <App>
 *     <header>          — logo + tab bar
 *     <main>
 *       <DocumentsTab>  — shown when activeTab === "documents"
 *       <ConfigsTab>    — shown when activeTab === "configs"
 *
 * Tab switching is local state (useState). No router needed yet — the app
 * only has two views and no deep-links in Week 1.
 *
 * The actual content of each tab is a placeholder ("coming soon") for now.
 * Week 2 will fill in DocumentsTab, Week 3+ will fill in ConfigsTab.
 */

import { useState } from "react";

import ChunksTab from "./components/ChunksTab";
import ConfigsTab from "./components/ConfigsTab";
import DocumentsTab from "./components/DocumentsTab";

// Tab identifiers — a union type is better than a raw string so typos are
// caught at compile time rather than at runtime.
type Tab = "documents" | "configs" | "chunks";

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("documents");

  return (
    // min-h-screen: fill the full viewport height
    // bg-gray-50 text-gray-900: light background, dark text
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                               */}
      {/* ------------------------------------------------------------------ */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-4">
          {/* Logo / product name */}
          <h1 className="text-xl font-bold tracking-tight text-indigo-600">
            RAGScope
          </h1>
          <span className="text-sm text-gray-400">
            Chrome DevTools for RAG pipelines
          </span>

          {/* Tab bar — pushed to the right with ml-auto */}
          <nav className="ml-auto flex gap-1">
            <TabButton
              label="Documents"
              active={activeTab === "documents"}
              onClick={() => setActiveTab("documents")}
            />
            <TabButton
              label="Configs"
              active={activeTab === "configs"}
              onClick={() => setActiveTab("configs")}
            />
            <TabButton
              label="Chunks"
              active={activeTab === "chunks"}
              onClick={() => setActiveTab("chunks")}
            />
          </nav>
        </div>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Main content                                                         */}
      {/* ------------------------------------------------------------------ */}
      {/* Chunks tab can compare up to 3 configs side-by-side, so it needs the
          full viewport width. Documents/Configs tabs are list views and read
          better constrained. */}
      <main
        className={[
          "mx-auto px-6 py-8",
          activeTab === "chunks" ? "max-w-[1600px]" : "max-w-4xl",
        ].join(" ")}
      >
        {activeTab === "documents" && <DocumentsTab />}
        {activeTab === "configs" && <ConfigsTab />}
        {activeTab === "chunks" && <ChunksTab />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable tab button — keeps the active/inactive styling in one place.
// ---------------------------------------------------------------------------
function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
        active
          ? "bg-indigo-100 text-indigo-700"   // selected state
          : "text-gray-500 hover:text-gray-700 hover:bg-gray-100", // idle state
      ].join(" ")}
    >
      {label}
    </button>
  );
}

