const express = require("express");
const router = express.Router();

const isLogin = require("../../middleware/isLogin");
const { validateCreateServer, validateObjectIdParam } = require("../../middleware/validate");
const { isServerMember } = require("./server.middleware");
const {
  createServer,
  listMyServers,
  getServer,
  joinServer,
  leaveServer,
  listMembers,
} = require("./server.controller");
const channelRouter = require("../channels/channel.routes");

router.use(isLogin);

router.post("/", validateCreateServer, createServer);
router.get("/", listMyServers);
router.get("/:serverId", validateObjectIdParam("serverId"), isServerMember, getServer);
router.post("/:serverId/join", validateObjectIdParam("serverId"), joinServer);
router.delete("/:serverId/leave", validateObjectIdParam("serverId"), leaveServer);
router.get(
  "/:serverId/members",
  validateObjectIdParam("serverId"),
  isServerMember,
  listMembers
);

// Channel routes are member-gated at this mount point, not per-route -
// every channel handler can assume req.membership is already set.
router.use(
  "/:serverId/channels",
  validateObjectIdParam("serverId"),
  isServerMember,
  channelRouter
);

module.exports = router;
