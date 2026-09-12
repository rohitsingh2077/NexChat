const express = require("express");
// mergeParams: mounted at /:channelId/documents inside channel.routes.js,
// which is itself mounted at /:serverId/channels - needs access to both
// parent routes' params.
const router = express.Router({ mergeParams: true });

const { validateObjectIdParam, validateDocumentTitle, validateVersionLabel } = require("../../middleware/validate");
const { requireChannelAccess } = require("../servers/server.middleware");
const {
  createDocument,
  listDocuments,
  getDocument,
  renameDocument,
  deleteDocument,
  listVersions,
  getVersion,
  createVersion,
} = require("./document.controller");

// isServerMember already ran (server.routes.js), so req.membership exists.
// requireChannelAccess additionally blocks a member whose allowedChannelIds
// doesn't include this :channelId - every route below operates on documents
// scoped to one specific channel, so this runs for all of them.
router.use(requireChannelAccess);

router.post("/", validateDocumentTitle, createDocument);
router.get("/", listDocuments);
router.get("/:documentId", validateObjectIdParam("documentId"), getDocument);
router.patch("/:documentId", validateObjectIdParam("documentId"), validateDocumentTitle, renameDocument);
router.delete("/:documentId", validateObjectIdParam("documentId"), deleteDocument);

// Version history (Phase 3b) - view/compare/restore all read through these;
// restore itself has no dedicated endpoint (see
// docs/interview-notes/document-collaboration.md "Phase 3b" for why it's
// deliberately just an ordinary edit on the client instead).
router.get("/:documentId/versions", validateObjectIdParam("documentId"), listVersions);
router.post("/:documentId/versions", validateObjectIdParam("documentId"), validateVersionLabel, createVersion);
router.get(
  "/:documentId/versions/:versionId",
  validateObjectIdParam("documentId"),
  validateObjectIdParam("versionId"),
  getVersion
);

module.exports = router;
