const mongoose = require("mongoose");
const serverService = require("../../modules/servers/server.service");

// join_server/leave_server only subscribe this socket connection to the
// server's realtime room - actually becoming a member is the durable
// operation at POST /api/servers/:id/join (see server.controller.js).
// Authorized fresh against ServerMembership every time, same as every other
// server-scoped check in this app - room membership is a subscription
// convenience, never treated as proof of authorization on its own.
const registerServerRoomHandlers = (io, socket) => {
  socket.on("join_server", async ({ serverId }, ack) => {
    try {
      if (!mongoose.isValidObjectId(serverId)) {
        return ack?.({ success: false, error: "INVALID_SERVER_ID" });
      }
      const membership = await serverService.getMembership(serverId, socket.userId);
      if (!membership) {
        return ack?.({ success: false, error: "NOT_A_SERVER_MEMBER" });
      }
      socket.join(`server:${serverId}`);
      ack?.({ success: true });
    } catch (error) {
      ack?.({ success: false, error: "INTERNAL_ERROR" });
    }
  });

  socket.on("leave_server", ({ serverId }, ack) => {
    if (mongoose.isValidObjectId(serverId)) {
      socket.leave(`server:${serverId}`);
    }
    ack?.({ success: true });
  });
};

module.exports = registerServerRoomHandlers;
