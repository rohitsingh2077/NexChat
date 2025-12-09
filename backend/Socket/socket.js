const express = require("express");
const http = require("http");
const { Server } = require("socket.io"); //correct import

const app = express();
const server = http.createServer(app);

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
  console.log(userSocketMap);
  return userSocketMap[recieverId];
};

io.on("connection", (socket) => {
  console.log(" Socket connected:", socket.id);

  // get userId from handshake query
  const userId = socket.handshake.query.userId?.toString();
  console.log(`user id recieved: `, userId);
  if (userId) {
    userSocketMap[userId] = socket.id;
    // attach userId to socket for easy reference when emitting
    socket.userId = userId;

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
});

module.exports = { io, app, server, getRecieverSocket };
