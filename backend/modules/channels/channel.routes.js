const express = require("express");
// mergeParams: mounted at /:serverId/channels in server.routes.js - needs
// access to the parent route's :serverId.
const router = express.Router({ mergeParams: true });

const {
  validateCreateChannel,
  validateObjectIdParam,
  validateGetMessages,
} = require("../../middleware/validate");
const { requireRole, requireChannelAccess } = require("../servers/server.middleware");
const { createChannel, listChannels, deleteChannel } = require("./channel.controller");
const { getChannelMessages } = require("../channelMessages/channelMessage.controller");
const documentRouter = require("../documents/document.routes");

// isServerMember already ran in server.routes.js before this router is
// reached, so req.membership is available in every handler below.
router.post("/", validateCreateChannel, requireRole(["owner", "admin"]), createChannel);
router.get("/", listChannels);
router.delete(
  "/:channelId",
  validateObjectIdParam("channelId"),
  requireRole(["owner", "admin"]),
  deleteChannel
);

// History load only - sending/editing/deleting channel messages goes
// through sockets (send_message/edit_message/delete_message), not REST. See
// docs/interview-notes/channel-messaging.md for why. Reuses the same
// cursor/limit validation as DM message history.
router.get(
  "/:channelId/messages",
  validateObjectIdParam("channelId"),
  requireChannelAccess,
  validateGetMessages,
  getChannelMessages
);

// Collaborative documents scoped to this channel. Metadata (create/list/get/
// rename/delete) is REST, same split as channel messages - the actual live
// editing happens over the document:* socket events (see
// realtime/handlers/documentHandler.js), not here. requireChannelAccess runs
// inside documentRouter itself since every route in it needs it.
router.use("/:channelId/documents", validateObjectIdParam("channelId"), documentRouter);

module.exports = router;
