const Channel = require("./channel.model");
const AppError = require("../../utils/AppError");

const createChannel = (serverId, name) => Channel.create({ serverId, name });

const listChannels = (serverId) =>
  Channel.find({ serverId }).sort({ createdAt: 1 });

const deleteChannel = async (serverId, channelId) => {
  const channel = await Channel.findOneAndDelete({ _id: channelId, serverId });
  if (!channel) throw new AppError(404, "CHANNEL_NOT_FOUND");
  return channel;
};

module.exports = { createChannel, listChannels, deleteChannel };
