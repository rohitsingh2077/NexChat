const ChannelMessage = require("./channelMessage.model");
const AppError = require("../../utils/AppError");

const MAX_CONTENT_LENGTH = 5000; // same limit as DM messages, for consistency

const validateContent = (content) => {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new AppError(400, "CONTENT_REQUIRED");
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new AppError(400, "CONTENT_TOO_LONG");
  }
};

// Idempotent on clientMessageId, same pattern as DM messageController.js
// sendMessage - a retried send_message ack (dropped ack, client reconnect
// mid-flight) collides into the already-saved document instead of creating
// a duplicate.
const sendMessage = async ({ channelId, senderId, content, clientMessageId }) => {
  validateContent(content);
  if (typeof clientMessageId !== "string" || !clientMessageId || clientMessageId.length > 100) {
    throw new AppError(400, "CLIENT_MESSAGE_ID_REQUIRED");
  }

  try {
    const message = await new ChannelMessage({
      channelId,
      senderId,
      content,
      clientMessageId,
    }).save();
    return { message, isNewMessage: true };
  } catch (error) {
    if (error.code !== 11000) throw error;
    const message = await ChannelMessage.findOne({ clientMessageId });
    if (!message) throw error;
    return { message, isNewMessage: false };
  }
};

// Ownership check and update happen in one atomic query, so there's no
// separate find-then-update race window - only the original sender may edit.
const editMessage = async ({ channelId, messageId, senderId, content }) => {
  validateContent(content);
  const message = await ChannelMessage.findOneAndUpdate(
    { _id: messageId, channelId, senderId },
    { content, editedAt: new Date() },
    { new: true }
  );
  if (!message) throw new AppError(404, "MESSAGE_NOT_FOUND_OR_NOT_YOURS");
  return message;
};

const CAN_MODERATE = ["owner", "admin"];

// Sender can delete their own message; owner/admin can delete anyone's
// (moderation). No soft-delete/tombstone - a hard delete plus a
// "message_deleted" broadcast is enough for connected clients to remove it,
// and a client fetching history later simply never sees it.
const deleteMessage = async ({ channelId, messageId, actorId, actorRole }) => {
  const message = await ChannelMessage.findOne({ _id: messageId, channelId });
  if (!message) throw new AppError(404, "MESSAGE_NOT_FOUND");

  const isOwnMessage = String(message.senderId) === String(actorId);
  if (!isOwnMessage && !CAN_MODERATE.includes(actorRole)) {
    throw new AppError(403, "NOT_AUTHORIZED");
  }

  await message.deleteOne();
  return message;
};

const DEFAULT_PAGE_SIZE = 30;

// Same cursor-pagination shape as DM messageController.js getMessage - see
// messageModel.js LEARNING NOTES for why _id is the cursor.
const listMessages = async ({ channelId, cursor, limit }) => {
  const pageSize = limit ? Number(limit) : DEFAULT_PAGE_SIZE;
  const query = { channelId };
  if (cursor) query._id = { $lt: cursor };

  const page = await ChannelMessage.find(query)
    .sort({ _id: -1 })
    .limit(pageSize + 1);

  const hasMore = page.length > pageSize;
  const trimmed = hasMore ? page.slice(0, pageSize) : page;
  const nextCursor = hasMore ? String(trimmed[trimmed.length - 1]._id) : null;

  return { messages: trimmed.reverse(), hasMore, nextCursor };
};

module.exports = { sendMessage, editMessage, deleteMessage, listMessages };
