const friendService = require("../services/friendService");
const { io, getRecieverSocket } = require("../Socket/socket");

const shapeUser = (user) => ({
  _id: user._id,
  username: user.username,
  displayName: user.fullname,
  avatar: user.profilePicture,
});

const notify = (userId, event, payload) => {
  const socketId = getRecieverSocket(String(userId));
  if (socketId) io.to(socketId).emit(event, payload);
};

/*----------------------*/
/*send  friend request */
/*---------------------*/
const sendFriendRequest = async (req, res, next) => {
  try {
    const { receiverId } = req.body;
    const { request, autoAccepted } = await friendService.sendFriendRequest(
      req.user._id,
      receiverId
    );

    const otherUserId = autoAccepted
      ? String(request.sender) === String(req.user._id)
        ? request.receiver
        : request.sender
      : receiverId;

    notify(
      otherUserId,
      autoAccepted ? "friend:request_accepted" : "friend:request_received",
      { requestId: request._id, by: req.user._id }
    );

    return res.status(201).json({
      success: true,
      autoAccepted,
      requestId: request._id,
      status: request.status,
    });
  } catch (error) {
    next(error);
  }
};

const acceptFriendRequest = async (req, res, next) => {
  try {
    const request = await friendService.acceptFriendRequest(
      req.params.requestId,
      req.user._id
    );
    notify(request.sender, "friend:request_accepted", {
      requestId: request._id,
      by: req.user._id,
    });
    return res.status(200).json({ success: true, message: "Friend request accepted" });
  } catch (error) {
    next(error);
  }
};

const rejectFriendRequest = async (req, res, next) => {
  try {
    const request = await friendService.rejectFriendRequest(
      req.params.requestId,
      req.user._id
    );
    notify(request.sender, "friend:request_rejected", {
      requestId: request._id,
      by: req.user._id,
    });
    return res.status(200).json({ success: true, message: "Friend request rejected" });
  } catch (error) {
    next(error);
  }
};

const cancelFriendRequest = async (req, res, next) => {
  try {
    const request = await friendService.cancelFriendRequest(
      req.params.requestId,
      req.user._id
    );
    notify(request.receiver, "friend:request_cancelled", {
      requestId: request._id,
      by: req.user._id,
    });
    return res.status(200).json({ success: true, message: "Friend request cancelled" });
  } catch (error) {
    next(error);
  }
};

const removeFriend = async (req, res, next) => {
  try {
    const removed = await friendService.removeFriend(req.user._id, req.params.friendId);
    const otherUserId =
      String(removed.sender) === String(req.user._id) ? removed.receiver : removed.sender;
    notify(otherUserId, "friend:removed", { by: req.user._id });
    return res.status(200).json({ success: true, message: "Friend removed" });
  } catch (error) {
    next(error);
  }
};

const getFriendRequests = async (req, res, next) => {
  try {
    const requests = await friendService.getIncomingRequests(req.user._id);
    return res.status(200).json({
      success: true,
      requests: requests.map((r) => ({
        requestId: r.requestId,
        user: shapeUser(r.user),
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

const getSentRequests = async (req, res, next) => {
  try {
    const requests = await friendService.getOutgoingRequests(req.user._id);
    return res.status(200).json({
      success: true,
      requests: requests.map((r) => ({
        requestId: r.requestId,
        user: shapeUser(r.user),
        createdAt: r.createdAt,
      })),
    });
  } catch (error) {
    next(error);
  }
};

const getFriends = async (req, res, next) => {
  try {
    const friends = await friendService.getFriends(req.user._id);
    return res.status(200).json({
      success: true,
      friends: friends.map(shapeUser),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  removeFriend,
  getFriendRequests,
  getSentRequests,
  getFriends,
};
