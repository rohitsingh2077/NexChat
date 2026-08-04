const channelMessageService = require("./channelMessage.service");

const getChannelMessages = async (req, res, next) => {
  try {
    const { channelId } = req.params;
    const { cursor, limit } = req.query;
    const result = await channelMessageService.listMessages({ channelId, cursor, limit });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

module.exports = { getChannelMessages };
