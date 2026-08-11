const AppError = require("../../utils/AppError");
const serverService = require("./server.service");

// Loads the caller's membership for :serverId and attaches it as
// req.membership - every server-scoped route needs both "is this user a
// member" and "what's their role" (see requireRole below). Deliberately
// returns 403 (not 404) when no membership exists, even if the server itself
// doesn't exist either - avoids leaking server existence to non-members.
const isServerMember = async (req, res, next) => {
  try {
    const membership = await serverService.getMembership(req.params.serverId, req.user._id);
    if (!membership) return next(new AppError(403, "NOT_A_SERVER_MEMBER"));
    req.membership = membership;
    next();
  } catch (error) {
    next(error);
  }
};

// Must run after isServerMember, which populates req.membership.
const requireRole = (roles) => (req, res, next) => {
  if (!req.membership || !roles.includes(req.membership.role)) {
    return next(new AppError(403, "INSUFFICIENT_SERVER_ROLE"));
  }
  next();
};

// Must run after isServerMember. Blocks a member whose allowedChannelIds
// doesn't include :channelId - see serverMembership.model.js and
// server.service.js canAccessChannel. Owner/admin always pass (their
// membership never has allowedChannelIds set).
const requireChannelAccess = (req, res, next) => {
  if (!req.membership || !serverService.canAccessChannel(req.membership, req.params.channelId)) {
    return next(new AppError(403, "CHANNEL_ACCESS_RESTRICTED"));
  }
  next();
};

module.exports = { isServerMember, requireRole, requireChannelAccess };
