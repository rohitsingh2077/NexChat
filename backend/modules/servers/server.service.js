const Server = require("./server.model");
const ServerMembership = require("./serverMembership.model");
const ServerJoinRequest = require("./serverJoinRequest.model");
const Channel = require("../channels/channel.model");
const AppError = require("../../utils/AppError");

const PUBLIC_USER_FIELDS = "_id username fullname profilePicture";

// User input dropped into a Mongo $regex must be escaped - an unescaped
// string lets a caller inject regex metacharacters (ReDoS via catastrophic
// backtracking, or just an unintended pattern match), the same class of
// issue as SQL injection for a LIKE clause.
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getMembership = (serverId, userId) =>
  ServerMembership.findOne({ serverId, userId });

// null/unset allowedChannelIds = unrestricted. Used both when deciding
// whether a member can open a given channel and when filtering the channel
// list itself (see channel.service.js listChannels).
const canAccessChannel = (membership, channelId) => {
  if (!membership.allowedChannelIds || membership.allowedChannelIds.length === 0) return true;
  return membership.allowedChannelIds.some((id) => String(id) === String(channelId));
};

const createServer = async (ownerId, { name, description, icon, joinPolicy }) => {
  const server = await Server.create({
    name,
    description,
    icon,
    ownerId,
    joinPolicy: joinPolicy === "approval_required" ? "approval_required" : "open",
  });

  await ServerMembership.create({ serverId: server._id, userId: ownerId, role: "owner" });

  // Every new server starts with one channel so it isn't empty on creation -
  // a small UX default, not a required part of the channel system itself.
  const defaultChannel = await Channel.create({ serverId: server._id, name: "general" });

  return { server, defaultChannel };
};

const listMyServers = async (userId) => {
  const memberships = await ServerMembership.find({ userId }).populate("serverId");
  return memberships
    // Guards against a dangling membership if a Server doc was ever removed
    // without cascading its memberships - not expected, but populate()
    // silently returns null rather than throwing, so this is cheap insurance.
    .filter((m) => m.serverId)
    .map((m) => ({ server: m.serverId, role: m.role }));
};

const getServerById = async (serverId) => {
  const server = await Server.findById(serverId);
  if (!server) throw new AppError(404, "SERVER_NOT_FOUND");
  return server;
};

// Any authenticated user can search servers they aren't a member of - this
// is the one server-related read that intentionally isn't membership-gated
// (there's nothing to discover otherwise). Regex, not a $text index: at this
// project's scale a handful of servers doesn't need index-backed relevance
// ranking, and a plain case-insensitive substring match is what "search
// servers..." actually implies in the UI. Revisit if the servers collection
// ever grows large enough for a full collection scan per search to matter.
const discoverServers = async (userId, search) => {
  const query = search ? { name: { $regex: escapeRegex(search), $options: "i" } } : {};
  const servers = await Server.find(query).limit(20);

  return Promise.all(
    servers.map(async (server) => {
      const [membership, pendingRequest, memberCount] = await Promise.all([
        ServerMembership.findOne({ serverId: server._id, userId }),
        ServerJoinRequest.findOne({ serverId: server._id, userId }),
        ServerMembership.countDocuments({ serverId: server._id }),
      ]);
      const relationship = membership ? "MEMBER" : pendingRequest ? "PENDING" : "NONE";
      return { server, memberCount, relationship };
    })
  );
};

// 'open' servers: joinServer creates membership immediately (original
// behavior). 'approval_required' servers: creates a ServerJoinRequest
// instead - see serverJoinRequest.model.js and approveJoinRequest below.
const joinServer = async (serverId, userId) => {
  const server = await Server.findById(serverId);
  if (!server) throw new AppError(404, "SERVER_NOT_FOUND");

  const existingMembership = await getMembership(serverId, userId);
  if (existingMembership) {
    return { outcome: "already_member", membership: existingMembership };
  }

  if (server.joinPolicy !== "approval_required") {
    try {
      const membership = await ServerMembership.create({ serverId, userId, role: "member" });
      return { outcome: "joined", membership };
    } catch (error) {
      if (error.code !== 11000) throw error;
      const existing = await ServerMembership.findOne({ serverId, userId });
      if (!existing) throw error;
      return { outcome: "already_member", membership: existing };
    }
  }

  try {
    const request = await ServerJoinRequest.create({ serverId, userId });
    return { outcome: "pending", request };
  } catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await ServerJoinRequest.findOne({ serverId, userId });
    if (!existing) throw error;
    return { outcome: "pending", request: existing };
  }
};

const listJoinRequests = (serverId) =>
  ServerJoinRequest.find({ serverId }).populate("userId", PUBLIC_USER_FIELDS);

// allowedChannelIds: pass a non-empty array to restrict the approved member
// to exactly those channels, or omit/pass empty for unrestricted access.
// No transaction across the ServerMembership create + ServerJoinRequest
// delete (same accepted trade-off as the rest of this app - see
// docs/interview-notes/message-delivery.md for the general reasoning). If a
// crash happens between them, a retried approve call safely no-ops on the
// membership (duplicate-key -> already exists) and still clears the request.
const approveJoinRequest = async (serverId, requestId, allowedChannelIds) => {
  const request = await ServerJoinRequest.findOne({ _id: requestId, serverId });
  if (!request) throw new AppError(404, "JOIN_REQUEST_NOT_FOUND");

  try {
    await ServerMembership.create({
      serverId,
      userId: request.userId,
      role: "member",
      allowedChannelIds: allowedChannelIds && allowedChannelIds.length ? allowedChannelIds : null,
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }

  await request.deleteOne();
  return request;
};

const rejectJoinRequest = async (serverId, requestId) => {
  const request = await ServerJoinRequest.findOneAndDelete({ _id: requestId, serverId });
  if (!request) throw new AppError(404, "JOIN_REQUEST_NOT_FOUND");
  return request;
};

// Ownership transfer isn't built yet, so an owner leaving would orphan the
// server - rejected outright rather than silently allowed. Revisit once
// ownership transfer exists.
const leaveServer = async (serverId, userId) => {
  const membership = await getMembership(serverId, userId);
  if (!membership) throw new AppError(404, "NOT_A_MEMBER");
  if (membership.role === "owner") throw new AppError(400, "OWNER_CANNOT_LEAVE");
  await membership.deleteOne();
  return membership;
};

// Owner/admin removing someone else - distinct from leaveServer (self-service).
const kickMember = async (serverId, targetUserId) => {
  const membership = await getMembership(serverId, targetUserId);
  if (!membership) throw new AppError(404, "NOT_A_MEMBER");
  if (membership.role === "owner") throw new AppError(400, "CANNOT_REMOVE_OWNER");
  await membership.deleteOne();
  return membership;
};

// Only the owner can grant/revoke admin - not admins-managing-admins, which
// would open a privilege-escalation path (an admin promoting a friend to
// admin, or demoting a rival admin). Ownership itself is never granted or
// revoked through this path; it only ever exists via createServer.
const ADJUSTABLE_ROLES = ["member", "admin"];

const updateMemberRole = async (serverId, targetUserId, newRole) => {
  if (!ADJUSTABLE_ROLES.includes(newRole)) throw new AppError(400, "INVALID_ROLE");
  const membership = await getMembership(serverId, targetUserId);
  if (!membership) throw new AppError(404, "NOT_A_MEMBER");
  if (membership.role === "owner") throw new AppError(400, "CANNOT_CHANGE_OWNER_ROLE");
  membership.role = newRole;
  await membership.save();
  return membership;
};

const listMembers = async (serverId) => {
  const memberships = await ServerMembership.find({ serverId }).populate(
    "userId",
    PUBLIC_USER_FIELDS
  );
  return memberships.map((m) => ({ user: m.userId, role: m.role, joinedAt: m.createdAt }));
};

module.exports = {
  getMembership,
  canAccessChannel,
  createServer,
  listMyServers,
  getServerById,
  discoverServers,
  joinServer,
  listJoinRequests,
  approveJoinRequest,
  rejectJoinRequest,
  leaveServer,
  kickMember,
  updateMemberRole,
  listMembers,
};
