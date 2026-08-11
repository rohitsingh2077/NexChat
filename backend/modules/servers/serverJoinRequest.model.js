const mongoose = require("mongoose");

const serverJoinRequestSchema = new mongoose.Schema(
  {
    serverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Server",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // A document's existence *is* the pending state - same convention as
    // friendRequestModel.js. Approve creates a ServerMembership and deletes
    // this doc; reject just deletes it. No REJECTED status kept, so the
    // same user can request again later without any revive/overwrite logic.
  },
  { timestamps: true }
);

// One outstanding request per (server, user) - a second joinServer call
// while one is already pending is idempotent, same duplicate-key-catch
// pattern as serverMembershipModel.js and friendRequestModel.js.
serverJoinRequestSchema.index({ serverId: 1, userId: 1 }, { unique: true });

// Serves listJoinRequests (owner/admin viewing pending requests for their server).
serverJoinRequestSchema.index({ serverId: 1 });

const ServerJoinRequest = mongoose.model("ServerJoinRequest", serverJoinRequestSchema);

module.exports = ServerJoinRequest;
