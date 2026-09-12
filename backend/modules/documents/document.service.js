const Y = require("yjs");
const Document = require("./document.model");
const DocumentVersion = require("./documentVersion.model");
const AppError = require("../../utils/AppError");

// Same field set as server.service.js's PUBLIC_USER_FIELDS - just enough to
// render a name/avatar next to "created by" / "last edited by" without
// exposing anything sensitive.
const PUBLIC_USER_FIELDS = "_id username fullname profilePicture";

const MAX_TITLE_LENGTH = 150;
// Generous cap on one incremental Yjs update (not the whole document state -
// Yjs updates only encode what changed since the client's last known state).
// Cheap abuse defense, same reasoning as Phase 1's MAX_CONTENT_BYTES.
const MAX_UPDATE_BYTES = 200 * 1024;

// PHASE 1 LEGACY - only used as the seed value for a document's `content`
// field at creation time, which DocumentEditor.jsx's client-side migration
// converts into the document's first real Yjs state on first open. See
// document.model.js LEARNING NOTES ("Phase 1 -> Phase 2 migration").
const EMPTY_CONTENT = { type: "doc", content: [{ type: "paragraph" }] };

// In-memory canonical Y.Doc per currently-open document - same process-local
// pattern as userSocketMap (realtime/socket.js) and documentViewers
// (realtime/handlers/documentHandler.js). Lazily hydrated from the last
// persisted yjsState on first access; documentHandler.js calls evictYDoc
// once the last viewer leaves so this doesn't grow unboundedly with every
// document ever opened during the process's lifetime.
const ydocCache = new Map(); // documentId -> Y.Doc

// Applies a Yjs update in-place to the server's canonical copy of a
// document and returns the full resulting state, ready to persist. A
// malformed/corrupt update (buggy or malicious client) throws here rather
// than silently corrupting the shared doc for every other viewer.
const loadYDoc = async (documentId) => {
  const cached = ydocCache.get(documentId);
  if (cached) return cached;

  const ydoc = new Y.Doc();
  const document = await Document.findById(documentId).select("yjsState");
  if (document?.yjsState) {
    Y.applyUpdate(ydoc, document.yjsState);
  }
  ydocCache.set(documentId, ydoc);
  return ydoc;
};

const evictYDoc = (documentId) => {
  ydocCache.delete(documentId);
};

const validateTitle = (title) => {
  if (typeof title !== "string" || title.trim().length === 0 || title.length > MAX_TITLE_LENGTH) {
    throw new AppError(400, "TITLE_INVALID");
  }
};

const createDocument = async ({ channelId, userId, title }) => {
  validateTitle(title);
  return Document.create({
    channelId,
    title: title.trim(),
    content: EMPTY_CONTENT,
    createdBy: userId,
    lastEditedBy: userId,
  });
};

// List view is deliberately light (no content field) - opening a channel's
// document list shouldn't pull every document's full JSON tree over the
// wire, only the metadata needed to render a list.
const listDocuments = (channelId) =>
  Document.find({ channelId })
    .select("title version createdBy lastEditedBy createdAt updatedAt")
    .populate("createdBy", PUBLIC_USER_FIELDS)
    .populate("lastEditedBy", PUBLIC_USER_FIELDS)
    .sort({ updatedAt: -1 });

const getDocument = async (channelId, documentId) => {
  const document = await Document.findOne({ _id: documentId, channelId })
    .populate("createdBy", PUBLIC_USER_FIELDS)
    .populate("lastEditedBy", PUBLIC_USER_FIELDS);
  if (!document) throw new AppError(404, "DOCUMENT_NOT_FOUND");
  return document;
};

const CAN_MODERATE = ["owner", "admin"];

// Same authorization shape as channelMessage.service.js deleteMessage: the
// creator can always act on their own document; owner/admin can act on
// anyone's (moderation). createdBy may be a raw ObjectId or a populated user
// object depending on the caller (getDocument always populates it), so both
// shapes are handled here rather than assuming one.
const assertCanModerate = (document, actorId, actorRole) => {
  const creatorId = document.createdBy?._id || document.createdBy;
  const isCreator = String(creatorId) === String(actorId);
  if (!isCreator && !CAN_MODERATE.includes(actorRole)) {
    throw new AppError(403, "NOT_AUTHORIZED");
  }
};

const renameDocument = async ({ channelId, documentId, actorId, actorRole, title }) => {
  validateTitle(title);
  const document = await getDocument(channelId, documentId);
  assertCanModerate(document, actorId, actorRole);
  document.title = title.trim();
  await document.save();
  return document;
};

const deleteDocument = async ({ channelId, documentId, actorId, actorRole }) => {
  const document = await getDocument(channelId, documentId);
  assertCanModerate(document, actorId, actorRole);
  await document.deleteOne();
  return document;
};

// The hot-path write, fired from the document:edit socket event (debounced
// client-side, ~400ms after typing pauses - not per keystroke). `update` is
// an incremental Yjs binary diff, not a full content snapshot - applying it
// to the server's canonical Y.Doc merges it via Yjs's CRDT algorithm rather
// than overwriting anything, which is what actually fixes the last-write-wins
// clobber Phase 1 had (see document.model.js LEARNING NOTES). $inc is still
// used for `version` (not a read-modify-write) so the counter stays
// race-free under concurrent edits without an application-level lock -
// MongoDB serializes writes to the same document, so each concurrent
// applyEdit call still gets a distinct, correctly-ordered version number.
const applyEdit = async ({ channelId, documentId, userId, update }) => {
  if (!Buffer.isBuffer(update) || update.length === 0) {
    throw new AppError(400, "UPDATE_INVALID");
  }
  if (update.length > MAX_UPDATE_BYTES) {
    throw new AppError(400, "UPDATE_TOO_LARGE");
  }

  const ydoc = await loadYDoc(documentId);
  try {
    Y.applyUpdate(ydoc, update);
  } catch (err) {
    throw new AppError(400, "UPDATE_INVALID");
  }

  const persistedState = Buffer.from(Y.encodeStateAsUpdate(ydoc));
  const document = await Document.findOneAndUpdate(
    { _id: documentId, channelId },
    { yjsState: persistedState, lastEditedBy: userId, $inc: { version: 1 } },
    { new: true }
  ).select("version updatedAt");
  if (!document) throw new AppError(404, "DOCUMENT_NOT_FOUND");
  return document;
};

// Auto-snapshots are cheap to trigger often (every "last viewer left" - see
// documentHandler.js) so they're capped tightly. Manual saves are a
// deliberate user action ("Save version") - capped much looser, as a pure
// abuse backstop rather than an expected-to-bite limit; see
// documentVersion.model.js LEARNING NOTES for why full snapshots (not a
// diff chain) make pruning safe to begin with (no version depends on one
// that got pruned).
const AUTO_VERSION_CAP = 15;
const MANUAL_VERSION_CAP = 50;

// Deletes the oldest versions of one kind for a document once its count
// exceeds `cap`. Runs after insert, not atomically with it - see
// documentVersion.model.js LEARNING NOTES for why an at-most-one-extra-row
// race here isn't worth a transaction.
const pruneVersions = async (documentId, kind, cap) => {
  const excess = await DocumentVersion.find({ documentId, kind })
    .select("_id")
    .sort({ createdAt: -1 })
    .skip(cap);
  if (excess.length === 0) return;
  await DocumentVersion.deleteMany({ _id: { $in: excess.map((v) => v._id) } });
};

// Shared by both snapshot paths (auto and manual) - the only difference
// between them is *when* they're called and whether a label is attached,
// not how the snapshot itself is captured. Reads from the same in-memory
// canonical Y.Doc applyEdit uses (loadYDoc), so a snapshot always reflects
// every edit that's been applied so far, including ones from the last few
// milliseconds - not a stale, separately-tracked copy.
const createVersionSnapshot = async ({ documentId, kind, userId, label }) => {
  const ydoc = await loadYDoc(documentId);
  const document = await Document.findById(documentId).select("version");
  if (!document) throw new AppError(404, "DOCUMENT_NOT_FOUND");

  const version = await DocumentVersion.create({
    documentId,
    yjsState: Buffer.from(Y.encodeStateAsUpdate(ydoc)),
    version: document.version,
    kind,
    label: label?.trim() || undefined,
    createdBy: userId,
  });

  await pruneVersions(documentId, kind, kind === "auto" ? AUTO_VERSION_CAP : MANUAL_VERSION_CAP);
  return version;
};

// Fired from documentHandler.js when the last viewer leaves a document -
// see document.service.js LEARNING NOTES in documentVersion.model.js for
// why "session boundary" was picked over a timer. Skips creating a snapshot
// if nothing has changed since the last one (comparing Document.version,
// bumped on every applyEdit, against the most recent existing snapshot's
// stored version) - otherwise opening and closing a document without
// editing it would still spam the version history.
const createAutoVersionSnapshot = async (documentId, userId) => {
  const document = await Document.findById(documentId).select("version");
  if (!document) return;

  const latest = await DocumentVersion.findOne({ documentId }).sort({ createdAt: -1 }).select("version");
  if (latest && latest.version === document.version) return;

  await createVersionSnapshot({ documentId, kind: "auto", userId });
};

const createManualVersionSnapshot = ({ documentId, userId, label }) =>
  createVersionSnapshot({ documentId, kind: "manual", userId, label });

// Deliberately light (no yjsState) - same reasoning as listDocuments not
// selecting `content`. Opening the version history panel shouldn't pull
// every past snapshot's full binary state over the wire, only enough to
// render a list the user picks from.
const listVersions = (documentId) =>
  DocumentVersion.find({ documentId })
    .select("version kind label createdBy createdAt")
    .populate("createdBy", PUBLIC_USER_FIELDS)
    .sort({ createdAt: -1 });

const getVersion = async (documentId, versionId) => {
  const version = await DocumentVersion.findOne({ _id: versionId, documentId }).populate("createdBy", PUBLIC_USER_FIELDS);
  if (!version) throw new AppError(404, "VERSION_NOT_FOUND");
  return version;
};

module.exports = {
  createDocument,
  listDocuments,
  getDocument,
  renameDocument,
  deleteDocument,
  applyEdit,
  evictYDoc,
  createAutoVersionSnapshot,
  createManualVersionSnapshot,
  listVersions,
  getVersion,
};
