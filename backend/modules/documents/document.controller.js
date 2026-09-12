const documentService = require("./document.service");

// yjsState is stored as a Buffer, which JSON.stringify would otherwise emit
// as the awkward {type:"Buffer", data:[...]} shape - base64 is what
// DocumentEditor.jsx expects to feed into Y.applyUpdate on load. `content`
// (Phase 1 legacy JSON) is still included: it's the seed DocumentEditor.jsx
// migrates from when yjsState is null. See document.model.js LEARNING NOTES.
const serializeDocument = (document) => {
  const obj = document.toObject ? document.toObject() : document;
  return {
    ...obj,
    yjsState: obj.yjsState ? Buffer.from(obj.yjsState).toString("base64") : null,
  };
};

const createDocument = async (req, res, next) => {
  try {
    const document = await documentService.createDocument({
      channelId: req.params.channelId,
      userId: req.user._id,
      title: req.body.title,
    });
    return res.status(201).json({ success: true, document: serializeDocument(document) });
  } catch (error) {
    next(error);
  }
};

const listDocuments = async (req, res, next) => {
  try {
    const documents = await documentService.listDocuments(req.params.channelId);
    return res.status(200).json({ success: true, documents });
  } catch (error) {
    next(error);
  }
};

const getDocument = async (req, res, next) => {
  try {
    const document = await documentService.getDocument(req.params.channelId, req.params.documentId);
    return res.status(200).json({ success: true, document: serializeDocument(document) });
  } catch (error) {
    next(error);
  }
};

const renameDocument = async (req, res, next) => {
  try {
    const document = await documentService.renameDocument({
      channelId: req.params.channelId,
      documentId: req.params.documentId,
      actorId: req.user._id,
      actorRole: req.membership.role,
      title: req.body.title,
    });
    return res.status(200).json({ success: true, document });
  } catch (error) {
    next(error);
  }
};

const deleteDocument = async (req, res, next) => {
  try {
    await documentService.deleteDocument({
      channelId: req.params.channelId,
      documentId: req.params.documentId,
      actorId: req.user._id,
      actorRole: req.membership.role,
    });
    return res.status(200).json({ success: true, message: "Document deleted" });
  } catch (error) {
    next(error);
  }
};

const serializeVersion = (version) => {
  const obj = version.toObject ? version.toObject() : version;
  return { ...obj, yjsState: obj.yjsState ? Buffer.from(obj.yjsState).toString("base64") : null };
};

const listVersions = async (req, res, next) => {
  try {
    // Confirms :documentId actually belongs to :channelId before touching
    // versions - DocumentVersion only stores documentId, not channelId, so
    // this is where that cross-check happens (same check getDocument does
    // internally via its {_id, channelId} filter).
    await documentService.getDocument(req.params.channelId, req.params.documentId);
    const versions = await documentService.listVersions(req.params.documentId);
    return res.status(200).json({ success: true, versions });
  } catch (error) {
    next(error);
  }
};

const getVersion = async (req, res, next) => {
  try {
    await documentService.getDocument(req.params.channelId, req.params.documentId);
    const version = await documentService.getVersion(req.params.documentId, req.params.versionId);
    return res.status(200).json({ success: true, version: serializeVersion(version) });
  } catch (error) {
    next(error);
  }
};

const createVersion = async (req, res, next) => {
  try {
    await documentService.getDocument(req.params.channelId, req.params.documentId);
    const version = await documentService.createManualVersionSnapshot({
      documentId: req.params.documentId,
      userId: req.user._id,
      label: req.body.label,
    });
    return res.status(201).json({ success: true, version: serializeVersion(version) });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createDocument,
  listDocuments,
  getDocument,
  renameDocument,
  deleteDocument,
  listVersions,
  getVersion,
  createVersion,
};
