import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import * as Y from "yjs";
import { yDocToProsemirrorJSON } from "y-prosemirror";
import { diffWords } from "diff";
import { base64ToUint8Array, YJS_FIELD } from "../../utils/yjsCodec";
import { CloseIcon, HistoryIcon } from "./icons";

// Walks a ProseMirror JSON tree (the shape yDocToProsemirrorJSON produces)
// into plain text, block nodes separated by newlines. Deliberately loses
// formatting (bold/headings/lists all collapse to plain text) - view and
// compare in this panel are plain-text-only, a scope decision, not an
// oversight (see docs/interview-notes/document-collaboration.md "Phase 3b":
// a full rich-text visual diff would need a second live TipTap instance and
// real diff-rendering across marks/nodes, not just text runs - restore, the
// part that actually needs full fidelity, uses the real JSON directly, not
// this flattened text).
const BLOCK_TYPES = new Set(["paragraph", "heading", "listItem", "blockquote", "codeBlock"]);
const jsonToPlainText = (node) => {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  const childText = (node.content || []).map(jsonToPlainText).join("");
  return BLOCK_TYPES.has(node.type) ? `${childText}\n` : childText;
};

// A version's yjsState is only ever decoded here, client-side, into a
// throwaway Y.Doc that's discarded immediately after - same "server never
// parses document content" principle as the live editor's own migration
// path (DocumentEditor.jsx), just reused for history instead of Phase 1
// migration. No ProseMirror schema is needed for this direction (Yjs ->
// JSON), unlike the reverse (prosemirrorJSONToYDoc, used for migration and
// nowhere in this file).
const decodeVersionToJSON = (base64YjsState) => {
  const tempDoc = new Y.Doc();
  Y.applyUpdate(tempDoc, base64ToUint8Array(base64YjsState));
  const json = yDocToProsemirrorJSON(tempDoc, YJS_FIELD);
  tempDoc.destroy();
  return json;
};

const formatTimestamp = (iso) => new Date(iso).toLocaleString();

const KindBadge = ({ kind }) => (
  <span
    className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide shrink-0 ${
      kind === "manual" ? "bg-blue-500/20 text-blue-300" : "bg-white/10 text-white/50"
    }`}
  >
    {kind}
  </span>
);

// A word-level diff between a past version's text and the document's
// current text (see currentText prop, a snapshot taken when the panel
// opened - not live-updating while it stays open, a deliberate
// simplification: re-diffing on every keystroke elsewhere would be wasted
// work for a panel whose whole point is comparing against a fixed point).
// diffWords (from `diff`/jsdiff) rather than a hand-rolled comparison - see
// docs/interview-notes/document-collaboration.md "Phase 3b" for why this is
// the one dependency in this feature that didn't need the "explain the
// hidden complexity" treatment Yjs itself got: text diffing is a genuinely
// commodity, well-solved problem, unlike CRDT merge.
const DiffView = ({ fromText, toText }) => {
  const parts = diffWords(fromText, toText);
  return (
    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
      {parts.map((part, i) => (
        <span
          key={i}
          className={
            part.added
              ? "bg-green-500/20 text-green-300"
              : part.removed
                ? "bg-red-500/20 text-red-300 line-through"
                : "text-white/70"
          }
        >
          {part.value}
        </span>
      ))}
    </pre>
  );
};

export const VersionHistoryPanel = ({ server, channel, documentId, currentText, onRestore, onClose }) => {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // full version + decoded text/json
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDiff, setShowDiff] = useState(true); // diff-vs-current, or plain view

  const basePath = `/api/servers/${server._id}/channels/${channel._id}/documents/${documentId}/versions`;

  const fetchVersions = async () => {
    try {
      setLoading(true);
      const res = await axios.get(basePath);
      if (res.data?.success) setVersions(res.data.versions || []);
    } catch (err) {
      console.error("Failed to fetch version history", err);
      toast.error("Failed to load version history");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  const handleSaveVersion = async () => {
    try {
      setSaving(true);
      const res = await axios.post(basePath, newLabel.trim() ? { label: newLabel.trim() } : {});
      if (res.data?.success) {
        setVersions((prev) => [res.data.version, ...prev]);
        setNewLabel("");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to save version");
    } finally {
      setSaving(false);
    }
  };

  const handleSelectVersion = async (versionMeta) => {
    try {
      setLoadingSelected(true);
      const res = await axios.get(`${basePath}/${versionMeta._id}`);
      if (!res.data?.success) return;
      const json = decodeVersionToJSON(res.data.version.yjsState);
      setSelected({ ...res.data.version, json, text: jsonToPlainText(json) });
    } catch (err) {
      console.error("Failed to load version", err);
      toast.error("Failed to load this version");
    } finally {
      setLoadingSelected(false);
    }
  };

  const handleRestoreClick = () => {
    if (!selected) return;
    onRestore(selected.json);
  };

  return (
    <div className="absolute inset-0 z-20 bg-slate-950/70 flex items-stretch justify-end">
      <div className="w-full max-w-md h-full bg-slate-900 border-l border-white/10 flex flex-col text-white">
        <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2 shrink-0">
          <HistoryIcon />
          <h3 className="text-sm font-semibold flex-1">Version history</h3>
          <button onClick={onClose} className="text-white/50 hover:text-white p-1 rounded">
            <CloseIcon />
          </button>
        </div>

        {!selected ? (
          <>
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2 shrink-0">
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Name this version (optional)"
                maxLength={150}
                className="flex-1 bg-white/10 border border-white/10 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-blue-400 placeholder-white/40"
              />
              <button
                onClick={handleSaveVersion}
                disabled={saving}
                className="bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0"
              >
                Save version
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
              {loading && <p className="text-xs text-white/50 px-2">Loading history...</p>}
              {!loading && versions.length === 0 && (
                <p className="text-xs text-white/50 px-2 mt-2">
                  No saved versions yet. One is captured automatically whenever everyone leaves this
                  document after an edit, or you can save one now.
                </p>
              )}
              {versions.map((v) => (
                <button
                  key={v._id}
                  onClick={() => handleSelectVersion(v)}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 flex items-start gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <KindBadge kind={v.kind} />
                      <p className="text-sm text-white/90 truncate">{v.label || `Edit #${v.version}`}</p>
                    </div>
                    <p className="text-[11px] text-white/40 mt-0.5">
                      {formatTimestamp(v.createdAt)}
                      {v.createdBy?.fullname ? ` · ${v.createdBy.fullname}` : ""}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="px-4 py-2 border-b border-white/10 flex items-center gap-2 shrink-0">
              <button onClick={() => setSelected(null)} className="text-white/60 hover:text-white text-xs shrink-0">
                &larr; Back
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{selected.label || `Edit #${selected.version}`}</p>
                <p className="text-[11px] text-white/40">
                  {formatTimestamp(selected.createdAt)}
                  {selected.createdBy?.fullname ? ` · ${selected.createdBy.fullname}` : ""}
                </p>
              </div>
            </div>

            <div className="px-4 py-2 border-b border-white/10 flex items-center gap-2 shrink-0">
              <button
                onClick={() => setShowDiff(true)}
                className={`text-[11px] px-2 py-1 rounded ${showDiff ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}
              >
                Compare to current
              </button>
              <button
                onClick={() => setShowDiff(false)}
                className={`text-[11px] px-2 py-1 rounded ${!showDiff ? "bg-white/10 text-white" : "text-white/50 hover:text-white"}`}
              >
                View only
              </button>
              <button
                onClick={handleRestoreClick}
                className="ml-auto bg-amber-500 hover:bg-amber-600 text-slate-900 text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0"
                title="Replace the current document with this version"
              >
                Restore this version
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3">
              {loadingSelected ? (
                <p className="text-xs text-white/50">Loading...</p>
              ) : showDiff ? (
                <>
                  <p className="text-[11px] text-white/40 mb-2">
                    Green = added since this version, red/struck-through = removed since this version.
                  </p>
                  <DiffView fromText={selected.text} toText={currentText} />
                </>
              ) : (
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-white/80">{selected.text}</pre>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
