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

module.exports = router;
