const channelService = require("./channel.service");

const createChannel = async (req, res, next) => {
  try {
    const channel = await channelService.createChannel(req.params.serverId, req.body.name);
    return res.status(201).json({ success: true, channel });
  } catch (error) {
    next(error);
  }
};

const listChannels = async (req, res, next) => {
  try {
    const channels = await channelService.listChannels(req.params.serverId);
    return res.status(200).json({ success: true, channels });
  } catch (error) {
    next(error);
  }
};

const deleteChannel = async (req, res, next) => {
  try {
    await channelService.deleteChannel(req.params.serverId, req.params.channelId);
    return res.status(200).json({ success: true, message: "Channel deleted" });
  } catch (error) {
    next(error);
  }
};

module.exports = { createChannel, listChannels, deleteChannel };
