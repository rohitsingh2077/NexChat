const express = require("express");
const http = require("http");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io"); //correct import

const registerPresenceHandlers = require("./handlers/presenceHandler");
const registerTypingHandlers = require("./handlers/typingHandler");
const registerDmHandlers = require("./handlers/dmHandler");
const registerServerRoomHandlers = require("./handlers/serverRoomHandler");
const registerChannelHandlers = require("./handlers/channelHandler");

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

// Each connection just wires up every handler group - all the actual event
// logic lives in realtime/handlers/*.js, grouped by concern (presence, DM
// typing/receipts, server/channel room membership, channel messaging).
io.on("connection", (socket) => {
  console.log(" Socket connected:", socket.id);

  registerPresenceHandlers(io, socket, userSocketMap);
  registerTypingHandlers(io, socket, userSocketMap);
  registerDmHandlers(io, socket, userSocketMap);
  registerServerRoomHandlers(io, socket);
  registerChannelHandlers(io, socket);
});

module.exports = { io, app, server, getRecieverSocket };
