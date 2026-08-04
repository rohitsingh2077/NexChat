const messageService = require("../../services/messageService");

// DM read receipts - unchanged behavior from before the realtime/ split.
// See docs/interview-notes/read-receipts.md for the full design.
const registerDmHandlers = (io, socket, userSocketMap) => {
  const userId = socket.userId;

  socket.on("message:seen", async ({ peerId }) => {
    try {
      const { updated } = await messageService.markConversationSeen(userId, peerId);
      if (updated === 0) return;

      const peerSocketId = userSocketMap[peerId];
      if (peerSocketId) {
        io.to(peerSocketId).emit("message:seen", { by: userId });
      }
    } catch (error) {
      console.error("message:seen failed:", error.message);
    }
  });
};

module.exports = registerDmHandlers;
