const mongoose = require("mongoose");

const channelMessageSchema = new mongoose.Schema(
  {
    channelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Channel",
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    content: { type: String, required: true },
    // Same idempotency-key pattern as the DM Message model's
    // clientMessageId - a retried send_message ack collides into the
    // existing document instead of creating a duplicate. See
    // channelMessage.service.js sendMessage.
    clientMessageId: { type: String, required: true },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// sparse: mirrors messageModel.js - required for the same reason (older
// documents without this field must not collide on a shared null value).
channelMessageSchema.index({ clientMessageId: 1 }, { unique: true, sparse: true });

// Supports cursor-paginated history, same {scopeId, _id} shape as the DM
// Message model's index - see messageModel.js LEARNING NOTES for why _id
// (not createdAt) is the cursor.
channelMessageSchema.index({ channelId: 1, _id: 1 });

const ChannelMessage = mongoose.model("ChannelMessage", channelMessageSchema);

module.exports = ChannelMessage;

/*
============================================================
LEARNING NOTES
============================================================

PURPOSE:
Channel messages are deliberately a separate model from the DM Message model
(see backend/models/messageModel.js), not a generalized "message" with an
optional channelId. See docs/interview-notes/channel-messaging.md for the
full trade-off - in short, DM delivery/read-receipt state is inherently
per-recipient (recieverId, status), which doesn't generalize cleanly to a
channel with many members.

WHY THIS MODEL REUSES THE clientMessageId PATTERN:
Channel messages are sent over a socket event (send_message) with an ack,
not REST like DMs - but the same failure mode applies: a dropped ack or a
client reconnect mid-flight looks identical to "did my message actually
send?" from the client's point of view. Reusing the exact same idempotency
key + unique sparse index + duplicate-key-catch pattern as messageModel.js
means retrying a send_message with the same clientMessageId is always safe,
regardless of transport.

INTERVIEW CONCEPTS:
- idempotency keys apply the same way over a socket ack as over an HTTP
  response - the transport doesn't change the reliability problem
- why a broadcast-target message (channel) and a single-recipient message
  (DM) are different enough in their delivery semantics to warrant separate
  models, even though both are "chat messages"
============================================================
*/
