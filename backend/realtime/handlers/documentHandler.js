const mongoose = require("mongoose");
const Document = require("../../modules/documents/document.model");
const serverService = require("../../modules/servers/server.service");
const documentService = require("../../modules/documents/document.service");
const { checkAndConsume } = require("../../middleware/rateLimit");

const isValidId = (value) => mongoose.isValidObjectId(value);

// Debounced client-side (~400ms after typing pauses), so this is
// defense-in-depth against a misbehaving client, not the primary throttle -
// same reasoning as SEND_MESSAGE_MAX in channelHandler.js.
const EDIT_WINDOW_MS = 10 * 1000;
const EDIT_MAX = 15;

// Awareness (cursor/selection/presence) isn't debounced client-side the way
// document:edit is - a selection changes on every arrow key or mouse drag -
// so this window is more generous than EDIT_MAX, but still bounded.
const AWARENESS_WINDOW_MS = 10 * 1000;
const AWARENESS_MAX = 60;

// documentId -> Set<userId> currently viewing. Process-local, same caveat as
// userSocketMap in realtime/socket.js - this is purely a "who else has this
// doc open" indicator, never used for authorization, and would need to move
// to a shared store (Redis) if this backend is ever scaled to multiple
// instances.
const documentViewers = new Map();

const addViewer = (documentId, userId) => {
  if (!documentViewers.has(documentId)) documentViewers.set(documentId, new Set());
  documentViewers.get(documentId).add(userId);
};

const removeViewer = (documentId, userId) => {
  const viewers = documentViewers.get(documentId);
  if (!viewers) return;
  viewers.delete(userId);
  if (viewers.size === 0) {
    documentViewers.delete(documentId);

    // Session-boundary auto-snapshot (Phase 3b) - fired *before* eviction
    // below, while loadYDoc's in-memory copy (which this reads from) still
    // exists, so this reflects every edit up to the moment the room emptied
    // rather than needing to re-hydrate first. Fire-and-forget: a snapshot
    // is a best-effort convenience, not something worth blocking this
    // socket's cleanup on, and createAutoVersionSnapshot already no-ops if
    // nothing changed since the last snapshot.
    documentService
      .createAutoVersionSnapshot(documentId, userId)
      .catch((err) => console.error(`Failed to auto-snapshot document ${documentId}:`, err.message));

    // No one has this document open anymore - drop the server's in-memory
    // canonical Y.Doc for it too. The next join/edit rehydrates it from the
    // last-persisted yjsState, so this is a memory bound, not a data loss
    // risk. See document.service.js loadYDoc / document.model.js LEARNING
    // NOTES.
    documentService.evictYDoc(documentId);
  }
};

// Loads just enough of the document (its channelId) to run the same
// channel-membership check every other channel-scoped socket event uses.
// Not cached - this is a mutation path, so authorization is re-checked fresh
// on every call rather than inferred from having previously joined the room.
const authorizeDocumentAccess = async (documentId, userId) => {
  const document = await Document.findById(documentId).select("channelId");
  if (!document) return { error: "DOCUMENT_NOT_FOUND" };
  const { error, membership } = await serverService.authorizeChannelAccess(document.channelId, userId);
  if (error) return { error };
  return { document, membership };
};

const registerDocumentHandlers = (io, socket) => {
  // Tracks which documents *this* connection has joined, so disconnect can
  // clean up viewer state without needing a reverse index elsewhere.
  const joinedDocumentIds = new Set();

  socket.on("document:join", async ({ documentId }, ack) => {
    if (!isValidId(documentId)) return ack?.({ success: false, error: "INVALID_DOCUMENT_ID" });
    const { error } = await authorizeDocumentAccess(documentId, socket.userId);
    if (error) return ack?.({ success: false, error });

    socket.join(`document:${documentId}`);
    joinedDocumentIds.add(documentId);
    addViewer(documentId, socket.userId);

    ack?.({ success: true, viewers: [...documentViewers.get(documentId)] });
    socket.to(`document:${documentId}`).emit("document:viewer_joined", { userId: socket.userId });
  });

  socket.on("document:leave", ({ documentId }, ack) => {
    if (isValidId(documentId)) {
      socket.leave(`document:${documentId}`);
      joinedDocumentIds.delete(documentId);
      removeViewer(documentId, socket.userId);
      socket.to(`document:${documentId}`).emit("document:viewer_left", { userId: socket.userId });
    }
    ack?.({ success: true });
  });

  // The live-editing event, fired debounced from the client - not per
  // keystroke. `update` is an incremental Yjs binary diff (the client's
  // Y.Doc 'update' event payload), not a full content snapshot. The server
  // merges it into its canonical Y.Doc for this document (CRDT merge, not an
  // overwrite) and relays the same raw update to every other viewer, who
  // apply it to their own local Y.Doc - this is the standard way Yjs updates
  // are synced over any transport. See document.model.js LEARNING NOTES for
  // why this is safe under Socket.IO's at-least-once delivery.
  socket.on("document:edit", async ({ documentId, update }, ack) => {
    try {
      if (!isValidId(documentId)) return ack?.({ success: false, error: "INVALID_DOCUMENT_ID" });
      if (!checkAndConsume(`document:edit:${socket.userId}`, EDIT_WINDOW_MS, EDIT_MAX)) {
        return ack?.({ success: false, error: "RATE_LIMITED" });
      }
      const { error, document } = await authorizeDocumentAccess(documentId, socket.userId);
      if (error) return ack?.({ success: false, error });

      // Socket.IO delivers binary payloads as Buffer (Node) - normalize in
      // case a client ever sends a Uint8Array/ArrayBuffer instead.
      const updateBuffer = Buffer.isBuffer(update) ? update : Buffer.from(update);

      const updated = await documentService.applyEdit({
        documentId,
        channelId: document.channelId,
        userId: socket.userId,
        update: updateBuffer,
      });

      ack?.({ success: true, version: updated.version, updatedAt: updated.updatedAt });
      socket.to(`document:${documentId}`).emit("document:updated", {
        documentId,
        update: updateBuffer,
        editedBy: socket.userId,
      });
    } catch (err) {
      ack?.({ success: false, error: err.message || "EDIT_FAILED" });
    }
  });

  // Cursor position, text selection, and presence color/name - Yjs's
  // Awareness protocol, Phase 2b. Deliberately NOT persisted anywhere (see
  // document.model.js LEARNING NOTES: MongoDB only ever stores yjsState) -
  // awareness is inherently ephemeral, so the server's only job is to relay
  // the opaque binary update to everyone else in the room, exactly like
  // document:edit's update payload. This is also why awareness never needed
  // `yjs`/`y-protocols` added as a *backend* dependency - the server never
  // decodes it, only forwards it. No ack: this is fire-and-forget, same as
  // typingHandler.js's typing/stopTyping events, not a request that needs a
  // confirmed outcome.
  socket.on("document:awareness", async ({ documentId, update }) => {
    if (!isValidId(documentId)) return;
    if (!checkAndConsume(`document:awareness:${socket.userId}`, AWARENESS_WINDOW_MS, AWARENESS_MAX)) return;
    const { error } = await authorizeDocumentAccess(documentId, socket.userId);
    if (error) return;

    const updateBuffer = Buffer.isBuffer(update) ? update : Buffer.from(update);
    socket.to(`document:${documentId}`).emit("document:awareness", {
      documentId,
      update: updateBuffer,
    });
  });

  // Mirrors presenceHandler.js's disconnect cleanup, scoped to documents
  // instead of global online status - a dropped connection (tab closed,
  // network loss) must not leave a stale "still viewing" entry behind.
  socket.on("disconnect", () => {
    for (const documentId of joinedDocumentIds) {
      removeViewer(documentId, socket.userId);
      socket.to(`document:${documentId}`).emit("document:viewer_left", { userId: socket.userId });
    }
  });
};

module.exports = registerDocumentHandlers;
