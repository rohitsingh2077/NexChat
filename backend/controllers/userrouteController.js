const Conversation = require("../models/conversationModel");
const User = require("../models/user");
const friendService = require("../services/friendService");

const shapeUser = (user, friendshipStatus) => ({
  _id: user._id,
  username: user.username,
  displayName: user.fullname,
  avatar: user.profilePicture,
  messagePrivacy: user.messagePrivacy,
  friendshipStatus,
});

const getUserBySearch = async (req, res, next) => {
  try {
    const search = req.query.search || "";
    const currentUser = req.user._id;

    const users = await User.find({
      _id: { $ne: currentUser }, // exclude logged-in user

      $or: [
        { username: { $regex: search, $options: "i" } },
        { fullname: { $regex: search, $options: "i" } },
      ],
    })
      .select("_id username fullname profilePicture messagePrivacy") // only public fields
      .limit(20);

    const statusMap = await friendService.getFriendshipStatuses(
      currentUser,
      users.map((u) => u._id)
    );

    return res.status(200).json({
      success: true,
      users: users.map((u) => shapeUser(u, statusMap.get(String(u._id)) || "NONE")),
    });
  } catch (error) {
    next(error);
  }
};

const getcurrentChatters = async (req, res, next) => {
  try {
    const currentUserId = req.user._id.toString();

    const conversations = await Conversation.find({
      participants: currentUserId,
    })
      .sort({ updatedAt: -1 })
      .populate("participants", "_id username fullname profilePicture messagePrivacy");

    if (!conversations.length) {
      return res.status(200).json({
        success: true,
        message: "We are lonely",
        chatters: [],
      });
    }

    const seen = new Set();
    const uniqueChatters = [];

    conversations.forEach((conversation) => {
      conversation.participants.forEach((p) => {
        const id = p._id.toString();
        if (id !== currentUserId && !seen.has(id)) {
          seen.add(id);
          uniqueChatters.push(p);
        }
      });
    });

    const statusMap = await friendService.getFriendshipStatuses(
      currentUserId,
      uniqueChatters.map((u) => u._id)
    );

    return res.status(200).json({
      success: true,
      chatters: uniqueChatters.map((u) => shapeUser(u, statusMap.get(String(u._id)) || "NONE")),
    });
  } catch (error) {
    next(error);
  }
};


module.exports = { getUserBySearch,getcurrentChatters };
