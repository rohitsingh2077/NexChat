const mongoose = require("mongoose");

const documentVersionSchema = new mongoose.Schema(
  {
    documentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Document",
      required: true,
    },
    // A full CRDT state snapshot at capture time (Y.encodeStateAsUpdate),
    // same opaque-binary treatment as Document.yjsState - the server never
    // decodes this. Full snapshots, not a diff/patch chain, for the same
    // reason Document.yjsState is a full snapshot: Yjs's own structure
    // already collapses redundant history, and a snapshot can be loaded on
    // its own without replaying every version before it.
    yjsState: { type: Buffer, required: true },
    // Document.version at capture time - lets listVersions show "as of edit
    // #N" and lets the auto-snapshot trigger skip creating a duplicate
    // snapshot when nothing has changed since the last one (see
    // document.service.js createAutoVersionSnapshot).
    version: { type: Number, required: true },
    // 'auto': captured when the last viewer left a document that had
    // changed since its last snapshot (see documentHandler.js removeViewer).
    // 'manual': explicit "Save version" action - see document.service.js
    // pruning notes for why these two kinds are capped differently.
    kind: { type: String, enum: ["auto", "manual"], required: true },
    // User-provided name for a manual save (e.g. "Before rewrite"). Not set
    // for auto snapshots - the UI labels those by timestamp instead.
    label: { type: String, trim: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

// Supports the one real read pattern: "list this document's version history,
// newest first" (document.service.js listVersions) and the pruning query
// (oldest-of-kind for a document). Same shape/justification as
// document.model.js's own channelId index.
documentVersionSchema.index({ documentId: 1, createdAt: -1 });

const DocumentVersion = mongoose.model("DocumentVersion", documentVersionSchema);

module.exports = DocumentVersion;

/*
============================================================
LEARNING NOTES
============================================================

PURPOSE:
Phase 3b of the collaborative documents feature - snapshots of a document's
CRDT state over time, so past states can be viewed, compared, and restored.
See docs/interview-notes/document-collaboration.md for the full design,
especially "how does restoring a version interact with a CRDT?" - the
central question this feature has to answer correctly, not just plausibly.

WHY A SEPARATE COLLECTION INSTEAD OF AN ARRAY ON Document:
Document.yjsState is read/written on every edit (the hot path); versions are
read rarely (opening the history panel) and written occasionally (session
end or an explicit save). Embedding an array of binary snapshots on Document
would mean every edit's query touches a growing array it doesn't need, and
Mongoose has no way to append-with-cap atomically the way $inc works for
version numbers - a separate collection with its own index is the standard
answer for "grows independently of the hot-path document" (same shape as
Message being separate from Conversation).

WHY EVERY VERSION IS A FULL SNAPSHOT, NOT A DIFF FROM THE PREVIOUS VERSION:
A diff chain would save storage but means restoring version N requires
replaying versions 1..N in order - more code, a real failure mode if any
intermediate version is ever pruned (see the cap in document.service.js),
and no benefit here: yjsState snapshots are already small (bounded by
MAX_UPDATE_BYTES-shaped documents), and Yjs's own encoding already discards
redundant tombstone history within a single snapshot.

FAILURE CASES:
- Two auto-snapshot triggers race (e.g. the last two viewers happen to leave
  within the same tick) -> both read the same Document.version, both would
  create a snapshot; harmless duplication (same content twice), not a
  correctness bug - see createAutoVersionSnapshot's version-check guard for
  why this is rare, not why it's impossible.
- Pruning happens after insert, not atomically with it - a crash between
  insert and prune could leave one extra version temporarily over the cap.
  Self-corrects on the next snapshot for that document; not worth a
  transaction for an at-most-one-extra-row storage overshoot.

INTERVIEW CONCEPTS:
- why hot-path and cold-path data for the same entity often belong in
  separate collections, not one growing document
- full snapshots vs. diff chains, and why "smaller storage" isn't always the
  right trade-off once restore complexity and partial-pruning failure modes
  are counted
============================================================
*/
