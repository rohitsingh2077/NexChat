const Conversation = require("../models/conversationModel");
const User = require("../models/user");
const friendService = require("../services/friendService");
const ServerMembership = require("../modules/servers/serverMembership.model");
const AppError = require("../utils/AppError");

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


// The "global profile" view - anyone can look up anyone's public profile
// (not friend-gated: friendship status is data shown *inside* the profile,
// not a precondition for viewing it, same as most chat apps). Aggregates
// three cheap, already-indexed reads in parallel rather than one big
// aggregation pipeline - none of these queries are expensive enough on
// their own to justify that complexity at this project's scale.
const getUserProfile = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user._id;
    const isSelf = String(userId) === String(currentUserId);

    const profileUser = await User.findById(userId).select(
      "_id username fullname profilePicture about createdAt messagePrivacy"
    );
    if (!profileUser) return next(new AppError(404, "USER_NOT_FOUND"));

    const [friendshipStatus, myFriends, theirFriends, myMemberships, theirMemberships] =
      await Promise.all([
        isSelf
          ? Promise.resolve("SELF")
          : friendService
              .getFriendshipStatuses(currentUserId, [userId])
              .then((map) => map.get(String(userId)) || "NONE"),
        friendService.getFriends(currentUserId),
        friendService.getFriends(userId),
        ServerMembership.find({ userId: currentUserId }).select("serverId"),
        ServerMembership.find({ userId }).populate("serverId", "name icon"),
      ]);

    const myFriendIds = new Set(myFriends.map((f) => String(f._id)));
    const mutualFriends = isSelf
      ? []
      : theirFriends.filter((f) => myFriendIds.has(String(f._id)));

    const myServerIds = new Set(myMemberships.map((m) => String(m.serverId)));
    const mutualServers = theirMemberships
      .filter((m) => m.serverId && (isSelf || myServerIds.has(String(m.serverId._id))))
      .map((m) => m.serverId);

    return res.status(200).json({
      success: true,
      profile: profileUser,
      friendshipStatus,
      stats: {
        friendsCount: theirFriends.length,
        serversCount: theirMemberships.length,
      },
      mutualServers,
      mutualFriends: mutualFriends.map((f) => ({
        _id: f._id,
        username: f.username,
        fullname: f.fullname,
        profilePicture: f.profilePicture,
      })),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getUserBySearch, getcurrentChatters, getUserProfile };
