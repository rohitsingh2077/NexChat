const FriendRequest = require("../models/friendRequestModel");
const User = require("../models/user");
const AppError = require("../utils/AppError");

const PUBLIC_USER_FIELDS = "_id username fullname profilePicture";

// Order-independent pair key - same result regardless of who calls it with
// which argument order, which is what lets the {userLow,userHigh} unique
// index catch a request in either direction.
const sortPair = (a, b) => [String(a), String(b)].sort();

const sendFriendRequest = async (senderId, receiverId) => {
  if (String(senderId) === String(receiverId)) {
    throw new AppError(400, "CANNOT_FRIEND_SELF");
  }

  const receiver = await User.findById(receiverId).select("_id");
  if (!receiver) {
    throw new AppError(404, "USER_NOT_FOUND");
  }

  const [userLow, userHigh] = sortPair(senderId, receiverId);

  try {
    const request = await FriendRequest.create({
      sender: senderId,
      receiver: receiverId,
      userLow,
      userHigh,
      status: "PENDING",
    });
    return { request, autoAccepted: false };
  } catch (error) {
    if (error.code !== 11000) throw error;

    // Unique index rejected the insert - a relationship already exists for
    // this pair. Re-read it to decide what that means (see model's
    // LEARNING NOTES for why this branch is safe under concurrency).
    const existing = await FriendRequest.findOne({ userLow, userHigh });
    if (!existing) throw error;

    if (existing.status === "ACCEPTED") {
      throw new AppError(400, "ALREADY_FRIENDS");
    }
    if (String(existing.sender) === String(senderId)) {
      throw new AppError(400, "REQUEST_ALREADY_EXISTS");
    }

    // existing.receiver === senderId: the other user already asked us first.
    // Turn their pending request into an accepted friendship atomically.
    const accepted = await FriendRequest.findOneAndUpdate(
      { _id: existing._id, status: "PENDING" },
      { status: "ACCEPTED" },
      { new: true }
    );
    if (accepted) {
      return { request: accepted, autoAccepted: true };
    }

    // Someone else resolved it between our read and write - check the
    // final state rather than assume failure.
    const final = await FriendRequest.findById(existing._id);
    if (final && final.status === "ACCEPTED") {
      return { request: final, autoAccepted: true };
    }
    throw new AppError(400, "REQUEST_ALREADY_EXISTS");
  }
};

const acceptFriendRequest = async (requestId, userId) => {
  const request = await FriendRequest.findOneAndUpdate(
    { _id: requestId, receiver: userId, status: "PENDING" },
    { status: "ACCEPTED" },
    { new: true }
  );
  if (request) return request;

  // The atomic update matched nothing - work out why purely to phrase a
  // clearer error. This read doesn't decide any state change, so it can't
  // reintroduce the race the atomic update above already closed.
  const existing = await FriendRequest.findById(requestId);
  if (!existing) throw new AppError(404, "FRIEND_REQUEST_NOT_FOUND");
  if (String(existing.receiver) !== String(userId)) {
    throw new AppError(403, "NOT_REQUEST_RECEIVER");
  }
  throw new AppError(409, "REQUEST_ALREADY_RESOLVED");
};

const rejectFriendRequest = async (requestId, userId) => {
  const request = await FriendRequest.findOneAndDelete({
    _id: requestId,
    receiver: userId,
    status: "PENDING",
  });
  if (request) return request;

  const existing = await FriendRequest.findById(requestId);
  if (!existing) throw new AppError(404, "FRIEND_REQUEST_NOT_FOUND");
  if (String(existing.receiver) !== String(userId)) {
    throw new AppError(403, "NOT_REQUEST_RECEIVER");
  }
  throw new AppError(409, "REQUEST_ALREADY_RESOLVED");
};

const cancelFriendRequest = async (requestId, userId) => {
  const request = await FriendRequest.findOneAndDelete({
    _id: requestId,
    sender: userId,
    status: "PENDING",
  });
  if (request) return request;

  const existing = await FriendRequest.findById(requestId);
  if (!existing) throw new AppError(404, "FRIEND_REQUEST_NOT_FOUND");
  if (String(existing.sender) !== String(userId)) {
    throw new AppError(403, "NOT_REQUEST_SENDER");
  }
  throw new AppError(409, "REQUEST_ALREADY_RESOLVED");
};

const removeFriend = async (userId, friendId) => {
  const [userLow, userHigh] = sortPair(userId, friendId);
  const removed = await FriendRequest.findOneAndDelete({
    userLow,
    userHigh,
    status: "ACCEPTED",
  });
  if (!removed) {
    throw new AppError(404, "FRIENDSHIP_NOT_FOUND");
  }
  return removed;
};

const getIncomingRequests = async (userId) => {
  const requests = await FriendRequest.find({ receiver: userId, status: "PENDING" })
    .sort({ createdAt: -1 })
    .populate("sender", PUBLIC_USER_FIELDS);

  return requests.map((r) => ({
    requestId: r._id,
    user: r.sender,
    createdAt: r.createdAt,
  }));
};

const getOutgoingRequests = async (userId) => {
  const requests = await FriendRequest.find({ sender: userId, status: "PENDING" })
    .sort({ createdAt: -1 })
    .populate("receiver", PUBLIC_USER_FIELDS);

  return requests.map((r) => ({
    requestId: r._id,
    user: r.receiver,
    createdAt: r.createdAt,
  }));
};

const getFriends = async (userId) => {
  const relationships = await FriendRequest.find({
    status: "ACCEPTED",
    $or: [{ sender: userId }, { receiver: userId }],
  })
    .populate("sender", PUBLIC_USER_FIELDS)
    .populate("receiver", PUBLIC_USER_FIELDS);

  return relationships.map((r) =>
    String(r.sender._id) === String(userId) ? r.receiver : r.sender
  );
};

// Batch-computes each candidate's relationship to `userId` in one query -
// used by user search so it doesn't run one relationship lookup per result.
const getFriendshipStatuses = async (userId, candidateIds) => {
  const map = new Map();
  if (!candidateIds.length) return map;

  const relationships = await FriendRequest.find({
    $or: [
      { sender: userId, receiver: { $in: candidateIds } },
      { receiver: userId, sender: { $in: candidateIds } },
    ],
  });

  for (const rel of relationships) {
    const isMeSender = String(rel.sender) === String(userId);
    const otherId = isMeSender ? rel.receiver : rel.sender;
    let status;
    if (rel.status === "ACCEPTED") status = "FRIENDS";
    else status = isMeSender ? "REQUEST_SENT" : "REQUEST_RECEIVED";
    map.set(String(otherId), status);
  }
  return map;
};

// Single-document lookup backed by the same {userLow,userHigh} unique index
// used everywhere else - used to gate messaging for private-profile users.
const areFriends = async (userIdA, userIdB) => {
  const [userLow, userHigh] = sortPair(userIdA, userIdB);
  const relationship = await FriendRequest.findOne({ userLow, userHigh, status: "ACCEPTED" });
  return !!relationship;
};

module.exports = {
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  removeFriend,
  getIncomingRequests,
  getOutgoingRequests,
  getFriends,
  getFriendshipStatuses,
  areFriends,
};
