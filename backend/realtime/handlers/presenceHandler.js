// Presence: tracks which userId maps to which live socket connection, and
// tells other clients when someone comes online/goes offline.
//
// A newly connected socket gets one full snapshot ("getOnlineUsers") of who
// is currently online. Everyone already connected gets a one-line delta
// ("user_online" / "user_offline") instead of the whole list being resent to
// them too - avoids O(n) payload broadcast to n clients (O(n^2) total data)
// on every single connect/disconnect.
const registerPresenceHandlers = (io, socket, userSocketMap) => {
  const userId = socket.userId;
  if (!userId) return;

  userSocketMap[userId] = socket.id;

  socket.emit("getOnlineUsers", Object.keys(userSocketMap));
  socket.broadcast.emit("user_online", { userId });

  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);

    if (userSocketMap[userId] === socket.id) {
      delete userSocketMap[userId];
      console.log("Removed user from map:", userId);
      io.emit("user_offline", { userId });
    }
  });
};

module.exports = registerPresenceHandlers;
