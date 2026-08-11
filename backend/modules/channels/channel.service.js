const Channel = require("./channel.model");
const AppError = require("../../utils/AppError");
const serverService = require("../servers/server.service");

const createChannel = (serverId, name) => Channel.create({ serverId, name });

// Filters out channels the caller's membership doesn't grant access to (see
// serverMembership.model.js allowedChannelIds) - a member restricted to
// specific channels shouldn't see the others in the sidebar at all, not just
// be blocked from opening them.
const listChannels = async (serverId, membership) => {
  const channels = await Channel.find({ serverId }).sort({ createdAt: 1 });
  return channels.filter((channel) => serverService.canAccessChannel(membership, channel._id));
};

const deleteChannel = async (serverId, channelId) => {
  const channel = await Channel.findOneAndDelete({ _id: channelId, serverId });
  if (!channel) throw new AppError(404, "CHANNEL_NOT_FOUND");
  return channel;
};

module.exports = { createChannel, listChannels, deleteChannel };
