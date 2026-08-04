// DM typing/stopTyping: unchanged behavior from before the realtime/ split -
// explicit start/stop, targeted at exactly one peer via userSocketMap[to].
//
// Channel typing is deliberately different: a single self-expiring "typing"
// event, no "stopTyping" counterpart. A channel can have many simultaneous
// typers, so tracking explicit per-user stop state isn't worth the
// bookkeeping - the receiving client just clears each user's indicator after
// ~3s of silence. Authorization here is intentionally cheap (the socket must
// already be in the channel's room, which was itself DB-authorized at
// join_channel time) rather than a fresh DB call per keystroke - this is a
// low-stakes, ephemeral signal, not a mutation like send/edit/delete.
const registerTypingHandlers = (io, socket, userSocketMap) => {
  socket.on("typing", (payload = {}) => {
    if (payload.to) {
      const receiverSocket = userSocketMap[payload.to];
      if (receiverSocket) {
        io.to(receiverSocket).emit("typing", socket.userId);
      }
      return;
    }

    if (payload.channelId && socket.rooms.has(`channel:${payload.channelId}`)) {
      socket.to(`channel:${payload.channelId}`).emit("typing", {
        channelId: payload.channelId,
        userId: socket.userId,
      });
    }
  });

  socket.on("stopTyping", ({ to } = {}) => {
    const receiverSocket = userSocketMap[to];
    if (receiverSocket) {
      io.to(receiverSocket).emit("stopTyping", socket.userId);
    }
  });
};

module.exports = registerTypingHandlers;
