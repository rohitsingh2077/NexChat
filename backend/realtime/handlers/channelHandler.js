const mongoose = require("mongoose");
const serverService = require("../../modules/servers/server.service");
const channelMessageService = require("../../modules/channelMessages/channelMessage.service");
const { checkAndConsume } = require("../../middleware/rateLimit");

const isValidId = (value) => mongoose.isValidObjectId(value);

// Same flood-guard shape as the DM REST rate limit (see routes/messsageRoute.js)
// - checkAndConsume is the transport-agnostic primitive, usable here since
// there's no Express middleware chain for socket events.
const SEND_MESSAGE_WINDOW_MS = 10 * 1000;
const SEND_MESSAGE_MAX = 20;

// authorizeChannelAccess (channel exists, caller is a server member, and -
// for members restricted to specific channels, see serverMembership.model.js
// allowedChannelIds - this channel is one they're allowed into) now lives in
// server.service.js, shared with the document handler. Most members are
// unrestricted; every server member can access every text channel by
// default (see docs/interview-notes/rbac.md).
const registerChannelHandlers = (io, socket) => {
  socket.on("join_channel", async ({ channelId }, ack) => {
    if (!isValidId(channelId)) return ack?.({ success: false, error: "INVALID_CHANNEL_ID" });
    const { error } = await serverService.authorizeChannelAccess(channelId, socket.userId);
    if (error) return ack?.({ success: false, error });
    socket.join(`channel:${channelId}`);
    ack?.({ success: true });
  });

  socket.on("leave_channel", ({ channelId }, ack) => {
    if (isValidId(channelId)) socket.leave(`channel:${channelId}`);
    ack?.({ success: true });
  });

  // Sending is socket-first (unlike DMs, which are REST for idempotent-retry
  // reasons - see docs/interview-notes/message-delivery.md). To not lose
  // that reliability property, this reuses the exact same clientMessageId
  // idempotency pattern, just acknowledged over the socket instead of an
  // HTTP response. Authorization is re-checked fresh here (not inferred from
  // room membership) because this is a mutation, not an ephemeral signal.
  socket.on("send_message", async ({ channelId, content, clientMessageId }, ack) => {
    try {
      if (!isValidId(channelId)) return ack?.({ success: false, error: "INVALID_CHANNEL_ID" });
      if (!checkAndConsume(`send_message:${socket.userId}`, SEND_MESSAGE_WINDOW_MS, SEND_MESSAGE_MAX)) {
        return ack?.({ success: false, error: "RATE_LIMITED" });
      }
      const { error } = await serverService.authorizeChannelAccess(channelId, socket.userId);
      if (error) return ack?.({ success: false, error });

      const { message, isNewMessage } = await channelMessageService.sendMessage({
        channelId,
        senderId: socket.userId,
        content,
        clientMessageId,
      });

      ack?.({ success: true, message, isNewMessage });
      // Only broadcast on the attempt that actually created the message -
      // same reasoning as DM sendMessage: a retry that found an existing
      // document must not show up twice in everyone else's channel view.
      if (isNewMessage) {
        socket.to(`channel:${channelId}`).emit("new_message", { message });
      }
    } catch (err) {
      ack?.({ success: false, error: err.message || "SEND_FAILED" });
    }
  });

  socket.on("edit_message", async ({ channelId, messageId, content }, ack) => {
    try {
      if (!isValidId(channelId) || !isValidId(messageId)) {
        return ack?.({ success: false, error: "INVALID_ID" });
      }
      const { error } = await serverService.authorizeChannelAccess(channelId, socket.userId);
      if (error) return ack?.({ success: false, error });

      const message = await channelMessageService.editMessage({
        channelId,
        messageId,
        senderId: socket.userId,
        content,
      });
      ack?.({ success: true, message });
      socket.to(`channel:${channelId}`).emit("message_edited", { message });
    } catch (err) {
      ack?.({ success: false, error: err.message || "EDIT_FAILED" });
    }
  });

  socket.on("delete_message", async ({ channelId, messageId }, ack) => {
    try {
      if (!isValidId(channelId) || !isValidId(messageId)) {
        return ack?.({ success: false, error: "INVALID_ID" });
      }
      const { error, membership } = await serverService.authorizeChannelAccess(channelId, socket.userId);
      if (error) return ack?.({ success: false, error });

      await channelMessageService.deleteMessage({
        channelId,
        messageId,
        actorId: socket.userId,
        actorRole: membership.role,
      });
      ack?.({ success: true });
      socket.to(`channel:${channelId}`).emit("message_deleted", { messageId });
    } catch (err) {
      ack?.({ success: false, error: err.message || "DELETE_FAILED" });
    }
  });
};

module.exports = registerChannelHandlers;
