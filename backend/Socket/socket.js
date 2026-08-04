const express = require("express");
const http = require("http");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io"); //correct import
const messageService = require("../services/messageService");

const app = express();
const server = http.createServer(app);

// now this can be used to create sockets

// userId -> socketId map
const userSocketMap = {}; // { "userId": "socketId" }

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173", // your frontend
    credentials: true,
    methods: ["GET", "POST"], //'methods', not 'method'
  },
});
//kind of place

// helper to get receiver's socketId
const getRecieverSocket = (recieverId) => {
  return userSocketMap[recieverId];
};

// Minimal cookie-header parser - avoids depending on cookie-parser's internals
// (which only run inside the Express req/res cycle) for the raw handshake header.
const parseCookies = (cookieHeader = "") => {
  return cookieHeader.split(";").reduce((acc, pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return acc;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
};

// Identity must come from the same verified jwt cookie the REST API trusts -
// never from a client-supplied handshake query value, or any socket could
// claim to be any userId and intercept another user's messages/presence.
io.use((socket, next) => {
  try {
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const token = cookies.jwt;
    if (!token) {
      return next(new Error("Unauthorized: no token"));
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId.toString();
    next();
  } catch (error) {
    next(new Error("Unauthorized: invalid token"));
  }
});

io.on("connection", (socket) => {
  console.log(" Socket connected:", socket.id);

  const userId = socket.userId;
  if (userId) {
    userSocketMap[userId] = socket.id;

    // emit online users to all connected clients
    io.emit("getOnlineUsers", Object.keys(userSocketMap));
  }

  // handle disconnect
  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);

    if (userId && userSocketMap[userId] === socket.id) {
      delete userSocketMap[userId];
      console.log("Removed user from map:", userId);
      // broadcast updated online users list
      io.emit("getOnlineUsers", Object.keys(userSocketMap));
    }
  });
  socket.on("typing", ({ to }) => {
    const receiverSocket = userSocketMap[to];
    if (receiverSocket) {
      io.to(receiverSocket).emit("typing", socket.userId);
    }
  });

  socket.on("stopTyping", ({ to }) => {
    const receiverSocket = userSocketMap[to];
    if (receiverSocket) {
      io.to(receiverSocket).emit("stopTyping", socket.userId);
    }
  });

  // Read receipt: peerId is who the viewer (this authenticated socket) is
  // currently looking at. viewerId always comes from socket.userId (the
  // verified jwt), never the payload - see messageService.markConversationSeen.
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
});

module.exports = { io, app, server, getRecieverSocket };
