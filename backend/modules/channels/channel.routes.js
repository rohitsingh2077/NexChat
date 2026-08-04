const express = require("express");
// mergeParams: mounted at /:serverId/channels in server.routes.js - needs
// access to the parent route's :serverId.
const router = express.Router({ mergeParams: true });

const { validateCreateChannel, validateObjectIdParam } = require("../../middleware/validate");
const { requireRole } = require("../servers/server.middleware");
const { createChannel, listChannels, deleteChannel } = require("./channel.controller");

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

module.exports = router;
