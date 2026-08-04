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
