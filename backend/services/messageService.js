const mongoose = require("mongoose");
const Conversation = require("../models/conversationModel");
const Message = require("../models/messageModel");

// Marks every message viewerId received from peerId in their shared
// conversation as 'seen'. Called when viewerId's client has that
// conversation open (see Socket/socket.js message:seen handler) - viewerId
// is always taken from the authenticated socket, never the client payload,
// so a caller can only mark their own inbox as read.
const markConversationSeen = async (viewerId, peerId) => {
  if (!mongoose.isValidObjectId(peerId)) return { updated: 0 };

  const conversation = await Conversation.findOne({
    participants: { $all: [viewerId, peerId] },
  }).select("_id");
  if (!conversation) return { updated: 0 };

  const result = await Message.updateMany(
    {
      conversationId: conversation._id,
      senderId: peerId,
      recieverId: viewerId,
      status: { $ne: "seen" },
    },
    { $set: { status: "seen" } }
  );

  return { updated: result.modifiedCount };
};

module.exports = { markConversationSeen };

/*
============================================================
LEARNING NOTES
============================================================

PURPOSE:
Turns "the other person opened our conversation" into a durable read
receipt: every message they'd received from the peer flips from
sent/delivered to seen, in one bulk write.

WHY A BULK updateMany INSTEAD OF PER-MESSAGE UPDATES:
The caller (Socket/socket.js) only knows "viewer opened this conversation",
not which specific message ids are newly visible. Matching on
{conversationId, senderId: peer, recieverId: viewer, status: {$ne: 'seen'}}
lets Mongo find and flip everything unseen in one round trip, and doubles
as the idempotency guard: rerunning it when nothing changed just matches
zero documents (result.modifiedCount === 0), so the caller can safely skip
broadcasting a receipt.

FAILURE CASES:
- No conversation exists yet between the two users -> Conversation.findOne
  returns null, function returns {updated: 0} without touching Message at
  all. Not an error - there's nothing to mark seen.
- peerId is missing/malformed -> mongoose.isValidObjectId guards the query
  before it reaches Mongo, so a bad socket payload can't throw a CastError
  or probe query shape.
- Two "seen" events for the same conversation race each other (e.g. the
  viewer's client emits on both page-load and on a live incoming message
  within the same second) -> both updateMany calls are safe to run
  concurrently; whichever runs second matches zero remaining documents.

INTERVIEW CONCEPTS:
- read receipts as a derived/bulk state transition, not a per-message flag
  the client sets directly
- using the update filter itself (status: {$ne: 'seen'}) as a cheap
  idempotency check instead of a separate read-then-write
============================================================
*/
