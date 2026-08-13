const express = require("express");
const router = express.Router();

const isLogin = require("../../middleware/isLogin");
const {
  validateCreateServer,
  validateObjectIdParam,
  validateApproveJoinRequest,
  validateUpdateMemberRole,
  validateTransferOwnership,
  validateInviteCodeParam,
} = require("../../middleware/validate");
const { isServerMember, requireRole } = require("./server.middleware");
const { rateLimit, byUser } = require("../../middleware/rateLimit");

// User-keyed - caps how many servers one account can spin up per window
// (spam-creation).
const createServerRateLimit = rateLimit({ name: "create-server", windowMs: 10 * 60 * 1000, max: 10, keyFn: byUser });
// Invite codes are unguessable in practice (48 bits of randomness - see
// server.service.js generateInviteCodeToken), but this caps scripted
// guessing attempts anyway as defense-in-depth, same reasoning as every
// other rate limit in this app.
const joinByCodeRateLimit = rateLimit({ name: "join-by-code", windowMs: 10 * 60 * 1000, max: 20, keyFn: byUser });
const {
  createServer,
  listMyServers,
  discoverServers,
  getServer,
  regenerateInviteCode,
  revokeInviteCode,
  joinServer,
  joinByInviteCode,
  listJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  leaveServer,
  transferOwnership,
  kickMember,
  updateMemberRole,
  listMembers,
} = require("./server.controller");
const channelRouter = require("../channels/channel.routes");

router.use(isLogin);

router.post("/", createServerRateLimit, validateCreateServer, createServer);
router.get("/", listMyServers);
// Must be registered before "/:serverId" - otherwise Express would match
// "discover" as a :serverId value and 400 on the ObjectId check.
router.get("/discover", discoverServers);
// "/join/code/:code" is two segments, so it never collides with the
// single-segment "/:serverId" routes regardless of registration order -
// unlike "/discover" above, this one doesn't strictly need to come first,
// but it's kept near the other join entry point for readability.
router.post("/join/code/:code", validateInviteCodeParam, joinByCodeRateLimit, joinByInviteCode);

router.get("/:serverId", validateObjectIdParam("serverId"), isServerMember, getServer);
router.post("/:serverId/join", validateObjectIdParam("serverId"), joinServer);
router.delete("/:serverId/leave", validateObjectIdParam("serverId"), leaveServer);
router.post(
  "/:serverId/transfer-ownership",
  validateObjectIdParam("serverId"),
  isServerMember,
  requireRole(["owner"]),
  validateTransferOwnership,
  transferOwnership
);
router.post(
  "/:serverId/invite-code",
  validateObjectIdParam("serverId"),
  isServerMember,
  requireRole(["owner", "admin"]),
  regenerateInviteCode
);
router.delete(
  "/:serverId/invite-code",
  validateObjectIdParam("serverId"),
  isServerMember,
  requireRole(["owner", "admin"]),
  revokeInviteCode
);
router.get(
  "/:serverId/members",
  validateObjectIdParam("serverId"),
  isServerMember,
  listMembers
);
router.delete(
  "/:serverId/members/:userId",
  validateObjectIdParam("serverId"),
  validateObjectIdParam("userId"),
  isServerMember,
  requireRole(["owner", "admin"]),
  kickMember
);
// Owner-only (not requireRole(["owner","admin"])) - see server.service.js
// updateMemberRole for why admins can't manage other admins.
router.patch(
  "/:serverId/members/:userId/role",
  validateObjectIdParam("serverId"),
  validateObjectIdParam("userId"),
  isServerMember,
  requireRole(["owner"]),
  validateUpdateMemberRole,
  updateMemberRole
);

router.get(
  "/:serverId/join-requests",
  validateObjectIdParam("serverId"),
  isServerMember,
  requireRole(["owner", "admin"]),
  listJoinRequests
);
router.post(
  "/:serverId/join-requests/:requestId/approve",
  validateObjectIdParam("serverId"),
  validateObjectIdParam("requestId"),
  isServerMember,
  requireRole(["owner", "admin"]),
  validateApproveJoinRequest,
  approveJoinRequest
);
router.post(
  "/:serverId/join-requests/:requestId/reject",
  validateObjectIdParam("serverId"),
  validateObjectIdParam("requestId"),
  isServerMember,
  requireRole(["owner", "admin"]),
  rejectJoinRequest
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
