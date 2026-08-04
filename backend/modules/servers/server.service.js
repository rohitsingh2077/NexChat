const Server = require("./server.model");
const ServerMembership = require("./serverMembership.model");
const Channel = require("../channels/channel.model");
const AppError = require("../../utils/AppError");

const PUBLIC_USER_FIELDS = "_id username fullname profilePicture";

const getMembership = (serverId, userId) =>
  ServerMembership.findOne({ serverId, userId });

const createServer = async (ownerId, { name, description, icon }) => {
  const server = await Server.create({ name, description, icon, ownerId });

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

// Open join for now (any authenticated user who has the id can join) -
// invite-only/invite codes are a deliberate later refinement, not built yet.
const joinServer = async (serverId, userId) => {
  const server = await Server.findById(serverId).select("_id");
  if (!server) throw new AppError(404, "SERVER_NOT_FOUND");

  try {
    const membership = await ServerMembership.create({ serverId, userId, role: "member" });
    return { membership, alreadyMember: false };
  } catch (error) {
    if (error.code !== 11000) throw error;
    // Unique index rejected the insert - already a member. Re-read instead
    // of erroring, same pattern as friendService.sendFriendRequest.
    const existing = await ServerMembership.findOne({ serverId, userId });
    if (!existing) throw error;
    return { membership: existing, alreadyMember: true };
  }
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

const listMembers = async (serverId) => {
  const memberships = await ServerMembership.find({ serverId }).populate(
    "userId",
    PUBLIC_USER_FIELDS
  );
  return memberships.map((m) => ({ user: m.userId, role: m.role, joinedAt: m.createdAt }));
};

module.exports = {
  getMembership,
  createServer,
  listMyServers,
  getServerById,
  joinServer,
  leaveServer,
  listMembers,
};
