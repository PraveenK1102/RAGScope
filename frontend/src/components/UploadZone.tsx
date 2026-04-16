/**
 * UploadZone — drag-and-drop + click-to-upload file picker.
 *
 * Two ways to pick a file:
 *   1. Drag a file from the OS and drop it onto the zone.
 *   2. Click the zone to open the native file picker.
 *
 * The parent owns the upload logic — we just hand back a File via onFile.
 * Parent controls the "uploading" state and disables interaction during it.
 */

import { useRef, useState } from "react";

// Accepted file extensions — mirrors the backend's ALLOWED_EXTENSIONS.
// Used in two places:
//   - <input accept="..."> → filters the native file picker
//   - client-side precheck → nicer error than round-tripping to the server
const ACCEPTED_EXTS = [".pdf", ".txt", ".md"] as const;
const ACCEPT_ATTR = ACCEPTED_EXTS.join(",");

interface Props {
  onFile: (file: File) => void;
  uploading: boolean;
}

export default function UploadZone({ onFile, uploading }: Props) {
  // `isDragging` drives a highlighted style while the user hovers with a file.
  const [isDragging, setIsDragging] = useState(false);

  // useRef lets us trigger the hidden <input> programmatically on click,
  // without making the input itself visible.
  const inputRef = useRef<HTMLInputElement>(null);

  // ------------------------------------------------------------------------
  // Shared validation + handoff. Returns true on success (for the drag path
  // so we can clear the "isDragging" highlight cleanly).
  // ------------------------------------------------------------------------
  function handleFile(file: File): void {
    const name = file.name.toLowerCase();
    const ok = ACCEPTED_EXTS.some((ext) => name.endsWith(ext));
    if (!ok) {
      // The parent displays errors; throw a synthetic one via onFile? No —
      // surface it via the browser alert for now; could pass onError later.
      alert(`Unsupported file type. Allowed: ${ACCEPTED_EXTS.join(", ")}`);
      return;
    }
    onFile(file);
  }

  // ------------------------------------------------------------------------
  // Drag events. IMPORTANT: onDragOver MUST call preventDefault(), otherwise
  // the browser's default is to reject the drop and your onDrop never fires.
  // ------------------------------------------------------------------------
  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  }

  function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (uploading) return; // ignore drops while an upload is in flight

    const file = e.dataTransfer.files[0]; // only first file — single-upload for now
    if (file) handleFile(file);
  }

  // ------------------------------------------------------------------------
  // Click path: clicking anywhere on the zone triggers the hidden input.
  // ------------------------------------------------------------------------
  function onClickZone() {
    if (uploading) return;
    inputRef.current?.click();
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset the input value so selecting the SAME file twice still fires change.
    e.target.value = "";
  }

  // ------------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------------
  return (
    <div
      onClick={onClickZone}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      role="button"
      tabIndex={0}
      className={[
        "rounded-md border-2 border-dashed px-6 py-8 text-center transition-colors",
        "cursor-pointer select-none",
        uploading
          ? "border-gray-300 bg-gray-100 cursor-wait"
          : isDragging
            ? "border-indigo-400 bg-indigo-50"
            : "border-gray-300 bg-white hover:bg-gray-50",
      ].join(" ")}
    >
      {uploading ? (
        <p className="text-sm text-gray-600">Uploading...</p>
      ) : (
        <>
          <p className="text-sm font-medium text-gray-700">
            Drop a file here, or click to choose
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Accepted: {ACCEPTED_EXTS.join(", ")}
          </p>
        </>
      )}

      {/* Hidden input — the click handler above triggers it. */}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        onChange={onInputChange}
        className="hidden"
      />
    </div>
  );
}
