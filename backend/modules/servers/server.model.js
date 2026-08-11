const mongoose = require("mongoose");

const serverSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    icon: { type: String, default: "" },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // 'open' = joinServer creates membership immediately (existing behavior).
    // 'approval_required' = joinServer creates a ServerJoinRequest instead;
    // an owner/admin must approve it before a ServerMembership exists.
    // See server.service.js joinServer/approveJoinRequest.
    joinPolicy: {
      type: String,
      enum: ["open", "approval_required"],
      default: "open",
    },
  },
  { timestamps: true }
);

const Server = mongoose.model("Server", serverSchema);

module.exports = Server;
