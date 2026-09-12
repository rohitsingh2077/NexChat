const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    channelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Channel",
      required: true,
    },
    title: { type: String, required: true, trim: true },
    // PHASE 1 LEGACY FIELD - no longer written after a document has a
    // yjsState (see below). Kept only so a document created before the
    // Phase 2 CRDT migration still has a readable initial state to migrate
    // from. New code should not read this field except for that one-time
    // migration. See LEARNING NOTES below ("Phase 1 -> Phase 2 migration").
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    // Yjs's own binary encoding of the document's current CRDT state
    // (Y.encodeStateAsUpdate(ydoc)), set by document.service.js
    // persistYjsState. This is a full-state snapshot, not an append-only
    // update log - Yjs's CRDT structure already collapses redundant history,
    // so storage stays bounded to "current state size" without a separate
    // compaction step. Absent on documents that predate the CRDT migration
    // (or were never opened after it) - see the lazy-migration flow below.
    yjsState: { type: Buffer },
    // Bumped on every saved edit (see document.service.js persistYjsState).
    // Was never a concurrency-control lock in Phase 1 and still isn't in
    // Phase 2 - Yjs updates are commutative and idempotent by construction,
    // so there's nothing to reject a write "for" anymore. It still exists
    // purely so clients can detect "the document changed underneath me" and
    // update their UI, not to gate writes. See LEARNING NOTES below.
    version: { type: Number, default: 0 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lastEditedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Supports the one real read pattern: "list documents in a channel". Same
// shape/justification as channel.model.js's own serverId index.
documentSchema.index({ channelId: 1 });

const Document = mongoose.model("Document", documentSchema);

module.exports = Document;

/*
============================================================
LEARNING NOTES
============================================================

PURPOSE:
Backs the "collaborative document" feature: a channel can have any number of
rich-text documents that its members create, view, and edit together in
close-to-real-time. Phase 1 shipped last-write-wins; this is Phase 2a, which
replaces that with real CRDT merging via Yjs. See
docs/interview-notes/document-collaboration.md for the Phase 1 trade-off
writeup this phase builds on.

WHY CRDT (YJS) INSTEAD OF OPERATIONAL TRANSFORM (Google Docs' approach):
Real concurrent editing (two people typing in the same document at the same
time, both edits surviving) needs either OT - every op is transformed
against every concurrently applied op so they compose losslessly - or a CRDT
- each client's edits merge automatically with a mathematical convergence
guarantee, no central transform step needed. OT has a long history of
subtle bugs even at well-resourced companies (Google Wave, early Docs) when
hand-rolled. Yjs is a mature, widely-used CRDT library with an official
TipTap binding (`@tiptap/extension-collaboration`), which is why it was
picked over hand-rolling OT or picking a CRDT library (Automerge) with no
first-party TipTap integration.

WHY THE SERVER NEVER PARSES DOCUMENT CONTENT:
`yjsState` is treated as an opaque binary blob everywhere on the backend -
the server applies updates to it (Y.applyUpdate) and persists it
(Y.encodeStateAsUpdate) without ever needing to know TipTap's ProseMirror
schema. All JSON <-> Yjs conversion happens client-side, where the real
schema already lives (see DocumentEditor.jsx). This keeps the backend simple
and schema-agnostic - a new node/mark type added to the editor later needs
zero backend changes.

PHASE 1 -> PHASE 2 MIGRATION (lazy, client-side):
A document created before this phase has `content` (JSON) but no
`yjsState`. Rather than a one-time migration script, DocumentEditor.jsx
detects a missing `yjsState` on load and converts the legacy `content` into
a fresh Y.Doc itself, using y-prosemirror's `prosemirrorJSONToYDoc` (which
needs the ProseMirror schema - available client-side, not server-side) then
immediately saves that as the document's first Yjs update. Brand new
documents go through the exact same path, seeded from
document.service.js's EMPTY_CONTENT - one code path handles both cases.

WHY UPDATES ARE SAFE UNDER AT-LEAST-ONCE DELIVERY:
Socket.IO does not guarantee exactly-once delivery - a retried or
duplicated `document:edit` is a real possibility. Yjs updates are
commutative and idempotent by construction (that's the CRDT convergence
guarantee): applying the same update twice, or applying two clients'
updates in different orders on different machines, converges to the same
final document state either way. This is a precise, structural property of
the algorithm, not a "should be fine in practice" assumption.

WHY `version` STILL EXISTS:
Same role as Phase 1: pure change-detection for the UI (a viewer count /
"someone else is here" style signal), never a concurrency-control gate.
Phase 2a doesn't need version to detect the LWW-clobber case anymore since
edits genuinely merge now, but the counter is kept for observability (e.g. a
future "edit count" UI) rather than removed and re-added later if needed.

FAILURE CASES:
- Concurrent edits from two users -> now merge via CRDT instead of one
  clobbering the other. This is the actual improvement Phase 2a delivers.
- Backend process restarts -> the in-memory per-document Y.Doc cache
  (document.service.js) is lost, but not data: the next join/edit rehydrates
  it from the last-persisted `yjsState`. Any edits made between the last
  persist and the crash are lost, the same exposure Phase 1 had for its
  unsaved debounce window.
- A malformed/corrupted binary update (buggy or malicious client) ->
  Y.applyUpdate is wrapped in try/catch in document.service.js; a bad update
  is rejected via the ack and never applied to the shared doc or relayed to
  other viewers.
- Multiple backend instances (not this project's current scale, see
  CLAUDE.md) -> the in-memory Y.Doc cache is process-local, same caveat as
  userSocketMap in realtime/socket.js. Two instances would each hold their
  own copy of a document and only reconcile through whichever writes land in
  MongoDB, not a true cross-instance Yjs merge - would need a shared
  pub/sub relay (e.g. Redis) to fix, deliberately out of scope here.

INTERVIEW CONCEPTS:
- Operational Transformation vs. CRDT, and why CRDT convergence doesn't
  require a central transform step
- why "commutative and idempotent" is the specific property that makes a
  CRDT safe under at-least-once delivery, when a naive "apply this diff"
  system would not be
- why storing full CRDT state snapshots (not an update log) keeps storage
  bounded without a separate compaction process
- why JSON <-> CRDT conversion belongs client-side here, and what that
  buys the backend (schema-agnostic storage)
============================================================
*/
