const serverService = require("./server.service");

const createServer = async (req, res, next) => {
  try {
    const { name, description, icon, joinPolicy } = req.body;
    const { server, defaultChannel } = await serverService.createServer(req.user._id, {
      name,
      description,
      icon,
      joinPolicy,
    });
    return res.status(201).json({ success: true, server, defaultChannel });
  } catch (error) {
    next(error);
  }
};

const listMyServers = async (req, res, next) => {
  try {
    const servers = await serverService.listMyServers(req.user._id);
    return res.status(200).json({ success: true, servers });
  } catch (error) {
    next(error);
  }
};

const discoverServers = async (req, res, next) => {
  try {
    const results = await serverService.discoverServers(req.user._id, req.query.search);
    return res.status(200).json({ success: true, results });
  } catch (error) {
    next(error);
  }
};

const getServer = async (req, res, next) => {
  try {
    const server = await serverService.getServerById(req.params.serverId);
    const payload = serverService.redactInviteCodeForRole(server, req.membership.role);
    return res.status(200).json({ success: true, server: payload, role: req.membership.role });
  } catch (error) {
    next(error);
  }
};

const regenerateInviteCode = async (req, res, next) => {
  try {
    const inviteCode = await serverService.regenerateInviteCode(req.params.serverId);
    return res.status(200).json({ success: true, inviteCode });
  } catch (error) {
    next(error);
  }
};

const revokeInviteCode = async (req, res, next) => {
  try {
    await serverService.revokeInviteCode(req.params.serverId);
    return res.status(200).json({ success: true, message: "Invite code revoked" });
  } catch (error) {
    next(error);
  }
};

const joinByInviteCode = async (req, res, next) => {
  try {
    const { outcome, membership, request } = await serverService.joinByInviteCode(
      req.params.code,
      req.user._id
    );
    const statusCode = outcome === "already_member" ? 200 : 201;
    return res.status(statusCode).json({
      success: true,
      outcome,
      serverId: membership?.serverId || request?.serverId,
      role: membership?.role,
      requestId: request?._id,
    });
  } catch (error) {
    next(error);
  }
};

const joinServer = async (req, res, next) => {
  try {
    const { outcome, membership, request } = await serverService.joinServer(
      req.params.serverId,
      req.user._id
    );
    const statusCode = outcome === "already_member" ? 200 : 201;
    return res.status(statusCode).json({
      success: true,
      outcome, // "joined" | "already_member" | "pending"
      role: membership?.role,
      requestId: request?._id,
    });
  } catch (error) {
    next(error);
  }
};

const listJoinRequests = async (req, res, next) => {
  try {
    const requests = await serverService.listJoinRequests(req.params.serverId);
    return res.status(200).json({
      success: true,
      requests: requests.map((r) => ({ requestId: r._id, user: r.userId, createdAt: r.createdAt })),
    });
  } catch (error) {
    next(error);
  }
};

const approveJoinRequest = async (req, res, next) => {
  try {
    await serverService.approveJoinRequest(
      req.params.serverId,
      req.params.requestId,
      req.body.allowedChannelIds
    );
    return res.status(200).json({ success: true, message: "Join request approved" });
  } catch (error) {
    next(error);
  }
};

const rejectJoinRequest = async (req, res, next) => {
  try {
    await serverService.rejectJoinRequest(req.params.serverId, req.params.requestId);
    return res.status(200).json({ success: true, message: "Join request rejected" });
  } catch (error) {
    next(error);
  }
};

const leaveServer = async (req, res, next) => {
  try {
    await serverService.leaveServer(req.params.serverId, req.user._id);
    return res.status(200).json({ success: true, message: "Left server" });
  } catch (error) {
    next(error);
  }
};

const transferOwnership = async (req, res, next) => {
  try {
    const membership = await serverService.transferOwnership(
      req.params.serverId,
      req.user._id,
      req.body.newOwnerUserId
    );
    return res.status(200).json({ success: true, newOwnerUserId: membership.userId });
  } catch (error) {
    next(error);
  }
};

const kickMember = async (req, res, next) => {
  try {
    await serverService.kickMember(req.params.serverId, req.params.userId);
    return res.status(200).json({ success: true, message: "Member removed" });
  } catch (error) {
    next(error);
  }
};

const updateMemberRole = async (req, res, next) => {
  try {
    const membership = await serverService.updateMemberRole(
      req.params.serverId,
      req.params.userId,
      req.body.role
    );
    return res.status(200).json({ success: true, role: membership.role });
  } catch (error) {
    next(error);
  }
};

const listMembers = async (req, res, next) => {
  try {
    const members = await serverService.listMembers(req.params.serverId);
    return res.status(200).json({ success: true, members });
  } catch (error) {
    next(error);
  }
};

module.exports = {
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
};
